/**
 * api-layer.js  —  Multi-source Live API orchestrator
 *
 * Architecture
 * ════════════
 * Each satellite has a prioritised source chain.  The layer tries sources in
 * order and uses the first one that succeeds.  It NEVER falls back to
 * simulation in Live Mode — if all sources fail the satellite is marked
 * DATA_UNAVAILABLE and rendered grey on the map (no fake position).
 *
 * Source registry
 * ───────────────
 *  Tier 0  wheretheiss.at   — ISS only, no key, best accuracy
 *  Tier 0  open-notify.org  — ISS secondary, no key
 *  Tier 1  CelesTrak TLE + satellite.js  — any NORAD ID, free, no key
 *             (fresh TLE fetched every 2 h → position propagated client-side)
 *  Tier 2  N2YO REST API  — any NORAD ID, free API key required (optional)
 *             (user-configurable via control panel; requires CORS proxy in
 *              production — instructions included in README)
 *
 * In CALCULATED MODE the tracker bypasses this layer completely and uses
 * satellite.js SGP4 with validated TLEs from CelesTrak.
 */

window.ApiLayer = (function () {
  'use strict';

  // ── Source definitions ─────────────────────────────────────────────────
  const SOURCES = {
    WHERETHEISS: 'wheretheiss',
    OPEN_NOTIFY: 'open_notify',
    CELESTRAK_TLE: 'celestrak_tle',
    N2YO: 'n2yo',
  };

  // Satellite → ordered source list
  const SOURCE_CHAIN = {
    25544: [SOURCES.WHERETHEISS, SOURCES.OPEN_NOTIFY, SOURCES.CELESTRAK_TLE],
    // All others: CelesTrak TLE propagation, with optional N2YO upgrade
    _default: [SOURCES.CELESTRAK_TLE, SOURCES.N2YO],
  };

  // ── Runtime state ──────────────────────────────────────────────────────
  let n2yoKey = null;          // set by user via setN2YOKey()
  let n2yoProxy = null;        // optional CORS proxy base URL
  const tleCache = {};         // noradId → { line1, line2, epoch, fetchedAt }
  const satrecCache = {};      // noradId → satellite.js satrec
  const sourceStatus = {};     // noradId → { source, lastSuccess, failures }
  const TLE_TTL_MS = 2 * 60 * 60 * 1000;  // 2 hours

  // ── Public configuration ────────────────────────────────────────────────
  function setN2YOKey(key)    { n2yoKey = key; }
  function setN2YOProxy(url)  { n2yoProxy = url; }
  function getSourceStatus()  { return { ...sourceStatus }; }

  // ── Primary entry point ─────────────────────────────────────────────────
  /**
   * Fetch live position for a single satellite.
   * Returns a normalised SatState object or null (data unavailable).
   */
  async function fetchPosition(noradId) {
    const chain = SOURCE_CHAIN[noradId] || SOURCE_CHAIN._default;
    for (const source of chain) {
      try {
        const data = await _trySource(source, noradId);
        if (data && _isValidPosition(data)) {
          _recordSuccess(noradId, source);
          return _normalise(data, source, noradId);
        }
      } catch (e) {
        _recordFailure(noradId, source, e.message);
      }
    }
    // All sources exhausted — return null (NOT simulation)
    console.warn(`[ApiLayer] All sources exhausted for NORAD ${noradId}`);
    return null;
  }

  /**
   * Batch fetch for multiple satellites.
   * Returns { noradId: SatState|null }
   */
  async function fetchAll(noradIds) {
    const results = {};
    await Promise.allSettled(
      noradIds.map(async id => {
        results[id] = await fetchPosition(id);
      })
    );
    return results;
  }

  // ── Source implementations ─────────────────────────────────────────────
  async function _trySource(source, noradId) {
    switch (source) {
      case SOURCES.WHERETHEISS:   return await _fetchWhereTheISS(noradId);
      case SOURCES.OPEN_NOTIFY:   return await _fetchOpenNotify(noradId);
      case SOURCES.CELESTRAK_TLE: return await _fetchViaCelesTrak(noradId);
      case SOURCES.N2YO:          return await _fetchN2YO(noradId);
      default: return null;
    }
  }

  // ── Tier 0a: wheretheiss.at ────────────────────────────────────────────
  async function _fetchWhereTheISS(noradId) {
    if (noradId !== 25544) return null;
    const url = `https://api.wheretheiss.at/v1/satellites/${noradId}`;
    const r = await _timedFetch(url, 6000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    return {
      _raw: d,
      lat:        d.latitude,
      lon:        d.longitude,
      alt:        d.altitude,
      velocity:   d.velocity,
      footprint:  d.footprint,
      visibility: d.visibility,
      timestamp:  d.timestamp,
    };
  }

  // ── Tier 0b: open-notify.org (ISS fallback) ───────────────────────────
  async function _fetchOpenNotify(noradId) {
    if (noradId !== 25544) return null;
    const url = 'https://api.open-notify.org/iss-now.json';
    const r = await _timedFetch(url, 5000);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.message !== 'success') throw new Error('API returned failure');
    return {
      _raw: d,
      lat:       parseFloat(d.iss_position.latitude),
      lon:       parseFloat(d.iss_position.longitude),
      alt:       408,        // open-notify doesn't return altitude
      velocity:  27600,      // typical ISS speed km/h
      footprint: 4500,
      visibility: null,
      timestamp:  d.timestamp,
    };
  }

  // ── Tier 1: CelesTrak TLE + satellite.js propagation ──────────────────
  async function _fetchViaCelesTrak(noradId) {
    if (!window.satellite) throw new Error('satellite.js not loaded');

    // Refresh TLE if stale or absent
    const cached = tleCache[noradId];
    if (!cached || Date.now() - cached.fetchedAt > TLE_TTL_MS) {
      await _refreshTLE(noradId);
    }

    const tle = tleCache[noradId];
    if (!tle) throw new Error(`No TLE available for NORAD ${noradId}`);

    // Validate TLE epoch — reject if older than 14 days
    _assertTLEFresh(tle, noradId);

    const rec = satrecCache[noradId];
    if (!rec) throw new Error(`satrec missing for NORAD ${noradId}`);

    const now = new Date();
    const pv  = satellite.propagate(rec, now);
    if (!pv || !pv.position || pv.position === undefined) {
      throw new Error('SGP4 propagation returned no position');
    }
    if (typeof pv.position.x !== 'number' || isNaN(pv.position.x)) {
      throw new Error('SGP4 returned NaN position — TLE may be corrupt');
    }

    const gmst   = satellite.gstime(now);
    const posGeo = satellite.eciToGeodetic(pv.position, gmst);
    const lat    = satellite.degreesLat(posGeo.latitude);
    const lon    = satellite.degreesLong(posGeo.longitude);
    const alt    = posGeo.height;
    const speed  = pv.velocity
      ? Math.sqrt(pv.velocity.x**2 + pv.velocity.y**2 + pv.velocity.z**2) * 3600
      : 27000;

    if (!_isReasonablePosition(lat, lon, alt, noradId)) {
      throw new Error(`Unreasonable position: lat=${lat} lon=${lon} alt=${alt}`);
    }

    return {
      _raw: { tle },
      lat, lon, alt,
      velocity:   speed,
      footprint:  _footprint(alt),
      visibility: null,
      timestamp:  Math.floor(now.getTime() / 1000),
      tleEpoch:   tle.epoch,
    };
  }

  async function _refreshTLE(noradId) {
    // Try CelesTrak GZIP-JSON query (most reliable, returns OMM JSON)
    const urls = [
      `https://celestrak.org/SPACETRACK/query/class/gp/CATNR/${noradId}/format/tle/`,
      `https://celestrak.org/satcat/tle.php?CATNR=${noradId}`,
    ];

    for (const url of urls) {
      try {
        const r = await _timedFetch(url, 8000);
        if (!r.ok) continue;
        const text = (await r.text()).trim();
        if (!text) continue;
        const parsed = _parseTLEText(noradId, text);
        if (parsed) {
          tleCache[noradId] = parsed;
          satrecCache[noradId] = satellite.twoline2satrec(parsed.line1, parsed.line2);
          console.log(`[ApiLayer] TLE loaded for NORAD ${noradId} epoch ${parsed.epoch.toISOString()}`);
          return;
        }
      } catch(e) {
        console.warn(`[ApiLayer] TLE fetch from ${url} failed:`, e.message);
      }
    }
    // Keep stale cache if it exists
    if (!tleCache[noradId]) {
      console.error(`[ApiLayer] Cannot obtain TLE for NORAD ${noradId}`);
    }
  }

  function _parseTLEText(noradId, text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    // Find line1/line2 pair for this NORAD ID
    for (let i = 0; i < lines.length; i++) {
      const l1 = lines[i], l2 = lines[i + 1];
      if (!l1 || !l2) continue;
      if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
      const parsedId = parseInt(l1.slice(2, 7).trim());
      if (parsedId !== noradId) { i++; continue; }
      // Validate checksum
      if (!_tleChecksumOK(l1) || !_tleChecksumOK(l2)) {
        console.warn(`[ApiLayer] TLE checksum failed for NORAD ${noradId}`);
        continue;
      }
      const epoch = _parseTLEEpoch(l1);
      return { line1: l1, line2: l2, epoch, fetchedAt: Date.now() };
    }
    return null;
  }

  function _tleChecksumOK(line) {
    if (line.length < 69) return false;
    let sum = 0;
    for (let i = 0; i < 68; i++) {
      const c = line[i];
      if (c === '-') sum += 1;
      else if (c >= '0' && c <= '9') sum += parseInt(c);
    }
    return (sum % 10) === parseInt(line[68]);
  }

  function _parseTLEEpoch(line1) {
    // Field 4: two-digit year + day-of-year fraction (chars 18-32)
    const epochStr = line1.slice(18, 32).trim();
    const year2    = parseInt(epochStr.slice(0, 2));
    const doy      = parseFloat(epochStr.slice(2));
    const year     = year2 >= 57 ? 1900 + year2 : 2000 + year2;
    const d = new Date(year, 0, 1);
    d.setDate(d.getDate() + Math.floor(doy) - 1);
    d.setMilliseconds(((doy % 1) * 86400 * 1000));
    return d;
  }

  function _assertTLEFresh(tle, noradId) {
    const ageMs = Date.now() - tle.epoch.getTime();
    const ageDays = ageMs / 86400000;
    if (ageDays > 14) {
      throw new Error(
        `TLE for NORAD ${noradId} is ${ageDays.toFixed(1)} days old — ` +
        `exceeds 14-day freshness limit. Refusing to propagate.`
      );
    }
    if (ageDays > 7) {
      console.warn(`[ApiLayer] TLE for NORAD ${noradId} is ${ageDays.toFixed(1)} days old — accuracy degraded`);
    }
  }

  // ── Tier 2: N2YO (optional, requires API key) ─────────────────────────
  async function _fetchN2YO(noradId) {
    if (!n2yoKey) return null; // gracefully skip if no key configured
    const base = n2yoProxy || 'https://api.n2yo.com/rest/v1/satellite';
    const url  = `${base}/positions/${noradId}/0/0/0/1/&apiKey=${n2yoKey}`;
    const r    = await _timedFetch(url, 7000);
    if (!r.ok) throw new Error(`N2YO HTTP ${r.status}`);
    const d = await r.json();
    if (!d.positions || !d.positions[0]) throw new Error('N2YO: empty positions array');
    const p = d.positions[0];
    return {
      _raw: d,
      lat:       p.satlatitude,
      lon:       p.satlongitude,
      alt:       p.sataltitude,
      velocity:  null,   // N2YO positions endpoint omits velocity
      footprint: _footprint(p.sataltitude),
      visibility: null,
      timestamp:  p.timestamp,
    };
  }

  // ── Validation helpers ─────────────────────────────────────────────────
  function _isValidPosition(d) {
    if (d === null || d === undefined) return false;
    if (typeof d.lat !== 'number' || isNaN(d.lat)) return false;
    if (typeof d.lon !== 'number' || isNaN(d.lon)) return false;
    if (typeof d.alt !== 'number' || isNaN(d.alt)) return false;
    if (d.lat < -90  || d.lat > 90)  return false;
    if (d.lon < -180 || d.lon > 180) return false;
    if (d.alt < 100  || d.alt > 50000) return false;  // sanity range km
    return true;
  }

  function _isReasonablePosition(lat, lon, alt, noradId) {
    const cat = SATELLITE_CATALOG[noradId];
    if (!cat) return _isValidPosition({ lat, lon, alt });
    // Allow ±300 km altitude variance from catalogue entry
    const altOK = Math.abs(alt - cat.alt) < 400;
    return _isValidPosition({ lat, lon, alt }) && altOK;
  }

  // ── Normalisation ──────────────────────────────────────────────────────
  function _normalise(raw, source, noradId) {
    const cat = SATELLITE_CATALOG[noradId];
    return {
      lat:        raw.lat,
      lon:        raw.lon,
      alt:        raw.alt,
      velocity:   raw.velocity  ?? (cat?.alt < 600 ? 27600 : 26800),
      footprint:  raw.footprint ?? _footprint(raw.alt),
      visibility: raw.visibility ?? null,
      timestamp:  raw.timestamp  ?? Math.floor(Date.now() / 1000),
      source,            // which API provided this
      tleEpoch:   raw.tleEpoch ?? null,
      liveData:   true,  // explicit flag — never set by simulation
    };
  }

  // ── Utility ────────────────────────────────────────────────────────────
  function _footprint(altKm) {
    const R = 6371;
    return 2 * Math.PI * R * Math.acos(R / (R + altKm)) * (180 / Math.PI) * 111.32;
  }

  async function _timedFetch(url, timeoutMs) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(tid);
    }
  }

  function _recordSuccess(noradId, source) {
    sourceStatus[noradId] = { source, lastSuccess: Date.now(), failures: 0 };
  }

  function _recordFailure(noradId, source, msg) {
    if (!sourceStatus[noradId]) sourceStatus[noradId] = { source, failures: 0 };
    sourceStatus[noradId].failures++;
    sourceStatus[noradId].lastError = msg;
  }

  // Public pre-warm: fetch TLEs for all catalogued sats in the background
  async function prewarm(noradIds) {
    console.log('[ApiLayer] Pre-warming TLE cache for', noradIds.length, 'satellites...');
    await Promise.allSettled(noradIds.map(id => _refreshTLE(id)));
    console.log('[ApiLayer] TLE pre-warm complete. Cached:', Object.keys(tleCache).join(', '));
  }

  return {
    fetchPosition,
    fetchAll,
    prewarm,
    setN2YOKey,
    setN2YOProxy,
    getSourceStatus,
    getTLECache: () => ({ ...tleCache }),
    SOURCES,
  };
})();
