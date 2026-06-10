/**
 * tracker.js — Dual-mode satellite tracker
 *
 * MODE A: "calculated"  — CelesTrak TLE + satellite.js propagation (SGP4)
 * MODE B: "live"        — wheretheiss.at API polling (original behaviour)
 *
 * The rendering loop never changes — both modes emit identical 'update' events.
 * Switch at runtime via Tracker.setMode('calculated' | 'live').
 */

window.Tracker = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const CELESTRAK_PROXY =
    'https://celestrak.org/SPACETRACK/query/class/gp/CATNR/{ID}/format/tle/orderby/EPOCH%20desc/limit/1/';
  const CELESTRAK_GROUP =
    'https://celestrak.org/SPACETRACK/query/class/gp/GROUP/stations/format/tle/';
  const WHERETHEISS_BASE = 'https://api.wheretheiss.at/v1/satellites/';

  const REFRESH_CALC_MS  = 2000;   // SGP4 re-propagate every 2 s
  const REFRESH_LIVE_MS  = 5000;   // API poll every 5 s
  const TLE_MAX_AGE_MS   = 2 * 60 * 60 * 1000; // re-fetch TLEs every 2 h
  const EARTH_RADIUS_KM  = 6371.0;
  const MIN_ELEVATION_DEG = 15;    // observability threshold

  // ── State ──────────────────────────────────────────────────────────────────
  let mode         = 'live';       // 'calculated' | 'live'
  let satellites   = {};           // id → sat state object
  let tleCache     = {};           // id → { line1, line2, fetchedAt }
  let satrec       = {};           // id → satellite.js satrec (calculated mode)
  let listeners    = {};
  let timer        = null;
  let myLat        = null;
  let myLon        = null;
  let demoAngles   = {};           // fallback for demo simulation
  let statusState  = 'acquiring';  // 'live' | 'calculated' | 'demo'

  // POV
  const POV_MODES = {
    MY_LOCATION: 'my_location',
    GLOBAL:      'global',
    ISS:         '25544',
    HUBBLE:      '20580',
    TIANGONG:    '48274',
    NOAA20:      '43205',
    STARLINK:    '44713',
  };
  let currentPOV  = 'my_location';
  let activeSatIds = Object.keys(SATELLITE_CATALOG).map(Number);

  Object.keys(SATELLITE_CATALOG).forEach(id => {
    demoAngles[id] = Math.random() * Math.PI * 2;
  });

  // ── Event bus ──────────────────────────────────────────────────────────────
  function on(e, fn) { (listeners[e] = listeners[e] || []).push(fn); }
  function emit(e, d) { (listeners[e] || []).forEach(f => f(d)); }

  // ── Public API ─────────────────────────────────────────────────────────────
  function setMode(m) {
    if (m !== 'calculated' && m !== 'live') return;
    mode = m;
    stop();
    start();
    emit('mode_changed', { mode });
    emit('status', mode === 'calculated' ? 'calculated' : 'acquiring');
    console.log('[Tracker] Mode →', mode);
  }

  function getMode() { return mode; }
  function setPOV(pov) {
    currentPOV = pov;
    activeSatIds = (pov === 'my_location' || pov === 'global')
      ? Object.keys(SATELLITE_CATALOG).map(Number)
      : [parseInt(pov)];
    emit('pov_changed', { pov, activeSatIds });
  }
  function setLocation(lat, lon) { myLat = lat; myLon = lon; }
  function getSatellites()       { return satellites; }
  function getData()             { return satellites[25544] || {}; }
  function isDemoMode()          { return statusState === 'demo'; }
  function getPOV()              { return currentPOV; }
  function getPOVModes()         { return POV_MODES; }
  function getOrbitProgress(id)  {
    const cat = SATELLITE_CATALOG[id || 25544];
    if (!cat) return 0;
    return ((Date.now() / 1000) % (cat.period * 60)) / (cat.period * 60);
  }
  function getOrbitProgressById(id) { return getOrbitProgress(id); }
  function getNearby(lat, lon, r)    { return _getNearby(lat, lon, r); }
  function getPassETA()              { return _computePasses(); }
  function haversine(a, b, c, d)     { return _haversine(a, b, c, d); }

  // ── Start / Stop ───────────────────────────────────────────────────────────
  function start() {
    stop();
    if (mode === 'calculated') {
      _loadAllTLEs().then(() => {
        _tickCalc();
        timer = setInterval(_tickCalc, REFRESH_CALC_MS);
      });
    } else {
      _tickLive();
      timer = setInterval(_tickLive, REFRESH_LIVE_MS);
    }
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE A — CALCULATED (SGP4 via satellite.js)
  // ══════════════════════════════════════════════════════════════════════════

  async function _loadAllTLEs() {
    // Try bulk fetch from CelesTrak group first
    try {
      const r = await fetch(CELESTRAK_GROUP, { cache: 'no-store' });
      if (!r.ok) throw new Error('group fetch failed');
      const text = await r.text();
      _parseTLEBlock(text);
      emit('status', 'calculated');
      statusState = 'calculated';
      return;
    } catch (e) {
      console.warn('[Tracker] CelesTrak group fetch failed, trying per-ID:', e.message);
    }
    // Fallback: fetch each satellite individually
    const ids = activeSatIds.slice();
    await Promise.allSettled(ids.map(id => _fetchTLE(id)));
    const anyLoaded = Object.keys(satrec).length > 0;
    if (anyLoaded) {
      emit('status', 'calculated');
      statusState = 'calculated';
    } else {
      console.warn('[Tracker] All TLE fetches failed — falling back to simulation');
      emit('status', 'demo');
      statusState = 'demo';
    }
  }

  function _parseTLEBlock(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i];
      const line1 = lines[i + 1];
      const line2 = lines[i + 2];
      if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) continue;
      const id = parseInt(line1.slice(2, 7).trim());
      if (!SATELLITE_CATALOG[id]) continue; // only track catalogued sats
      tleCache[id] = { line1, line2, name, fetchedAt: Date.now() };
      try {
        satrec[id] = satellite.twoline2satrec(line1, line2);
      } catch (e) {
        console.warn('[Tracker] satrec parse failed for', id, e.message);
      }
    }
  }

  async function _fetchTLE(id) {
    const cached = tleCache[id];
    if (cached && Date.now() - cached.fetchedAt < TLE_MAX_AGE_MS && satrec[id]) return;
    try {
      const url = CELESTRAK_PROXY.replace('{ID}', id);
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      _parseTLEBlock('PLACEHOLDER\n' + text); // name not critical here
    } catch (e) {
      console.warn('[Tracker] TLE fetch failed for NORAD', id, ':', e.message);
    }
  }

  function _tickCalc() {
    const now = new Date();
    const updates = {};

    for (const id of activeSatIds) {
      const cat = SATELLITE_CATALOG[id];
      if (!cat) continue;

      let posData = null;

      if (satrec[id]) {
        posData = _propagateSGP4(id, now);
      }

      if (!posData) {
        // Graceful fallback to kinematic simulation
        posData = _kinematicSim(id);
        if (statusState !== 'demo' && !satrec[id]) {
          // async refresh TLE without blocking
          _fetchTLE(id).then(() => {
            if (satrec[id]) emit('status', 'calculated');
          });
        }
      }

      if (!posData) continue;

      if (!satellites[id]) satellites[id] = { trail: [], orbit: [] };
      const sat = satellites[id];
      Object.assign(sat, posData);
      sat.trail.push([posData.lat, posData.lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      _computeOrbit(id);

      // Observability (only meaningful in calculated mode with real location)
      if (myLat !== null && satrec[id]) {
        sat.observability = _computeObservability(id, now);
      } else {
        sat.observability = null;
      }

      updates[id] = { ...sat, id, catalog: cat };
    }

    if (Object.keys(updates).length) {
      emit('update', { satellites: updates, pov: currentPOV, myLat, myLon, mode });
    }
    if (myLat !== null) emit('passes', _computePasses());
  }

  /**
   * Propagate with SGP4 and return a normalised sat-state object.
   */
  function _propagateSGP4(id, date) {
    try {
      const rec = satrec[id];
      const posVel = satellite.propagate(rec, date);
      if (!posVel || !posVel.position) return null;
      const { position: posEci, velocity: velEci } = posVel;

      const gmst = satellite.gstime(date);
      const posGeo = satellite.eciToGeodetic(posEci, gmst);

      const lat = satellite.degreesLat(posGeo.latitude);
      const lon = satellite.degreesLong(posGeo.longitude);
      const alt = posGeo.height; // km

      // Speed from velocity ECI vector
      const speed = Math.sqrt(velEci.x**2 + velEci.y**2 + velEci.z**2); // km/s

      // Footprint (horizon circle radius on ground)
      const footprint = 2 * Math.PI * EARTH_RADIUS_KM *
        Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + alt)) * (180 / Math.PI) * 111.32;

      return {
        lat, lon, alt,
        velocity: speed * 3600,      // km/h for display compatibility
        footprint,
        visibility: _eclipseCheck(posEci, date) ? 'eclipsed' : 'daylight',
        posEci,                       // keep for observability checks
        velEci,
      };
    } catch (e) {
      console.warn('[SGP4] propagation error for', id, ':', e.message);
      return null;
    }
  }

  // ── Step 4: Eclipse / Illumination check ────────────────────────────────
  /**
   * Returns true if satellite is in Earth's shadow (eclipsed).
   * Uses cylindrical shadow model: project sat ECI onto sun direction,
   * check perpendicular distance against Earth radius.
   */
  function _eclipseCheck(posEci, date) {
    const sunEci = _sunPositionECI(date);
    // Unit vector toward sun
    const sunMag = Math.sqrt(sunEci.x**2 + sunEci.y**2 + sunEci.z**2);
    const sunU = { x: sunEci.x/sunMag, y: sunEci.y/sunMag, z: sunEci.z/sunMag };
    // Project satellite position onto sun direction
    const dot = posEci.x*sunU.x + posEci.y*sunU.y + posEci.z*sunU.z;
    if (dot > 0) return false; // sat is on sun side of Earth → illuminated
    // Perpendicular distance from sat to sun-Earth line
    const perpSq = (posEci.x**2 + posEci.y**2 + posEci.z**2) - dot**2;
    return perpSq < EARTH_RADIUS_KM**2; // inside shadow cylinder
  }

  function _isIlluminated(posEci, date) {
    return !_eclipseCheck(posEci, date);
  }

  // ── Sun position in ECI (low-precision, sufficient for shadow) ───────────
  function _sunPositionECI(date) {
    // Astronomical Algorithms, Meeus Ch.25 (low precision)
    const JD = _julianDate(date);
    const n  = JD - 2451545.0;
    const L  = (280.460 + 0.9856474 * n) % 360;   // mean longitude deg
    const g  = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180; // mean anomaly rad
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2*g)) * Math.PI / 180;
    const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
    const R   = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2*g); // AU
    const AU_KM = 149597870.7;
    return {
      x:  R * AU_KM * Math.cos(lam),
      y:  R * AU_KM * Math.cos(eps) * Math.sin(lam),
      z:  R * AU_KM * Math.sin(eps) * Math.sin(lam),
    };
  }

  function _julianDate(d) {
    return d.getTime() / 86400000 + 2440587.5;
  }

  // ── Step 2: Look angles (elevation / azimuth) ────────────────────────────
  function _getLookAngles(id, date) {
    if (!satrec[id] || myLat === null) return null;
    try {
      const posVel = satellite.propagate(satrec[id], date);
      if (!posVel || !posVel.position) return null;
      const gmst = satellite.gstime(date);
      const posEcf = satellite.eciToEcf(posVel.position, gmst);
      const observer = satellite.geodeticToEcf({
        latitude:  satellite.degreesToRadians(myLat),
        longitude: satellite.degreesToRadians(myLon),
        height:    0.0,
      });
      const lookAngles = satellite.ecfToLookAngles(observer, posEcf);
      return {
        azimuth:   satellite.radiansToDegrees(lookAngles.azimuth),
        elevation: satellite.radiansToDegrees(lookAngles.elevation),
        rangeSat:  lookAngles.rangeSat,
        posEci:    posVel.position,
      };
    } catch(e) { return null; }
  }

  // ── Step 3: Ground darkness via SunCalc ─────────────────────────────────
  function _isGroundDark(date) {
    if (!window.SunCalc || myLat === null) return null; // unknown
    const times = SunCalc.getTimes(date, myLat, myLon);
    const now   = date.getTime();
    // Nautical twilight: sun between -6° and -12° below horizon
    // We want observer in nautical twilight or deeper darkness
    const nightStart = times.nauticalDusk.getTime();
    const nightEnd   = times.nauticalDawn.getTime();
    // Handle overnight window (nightStart > nightEnd wraps midnight)
    if (nightStart > nightEnd) {
      return now >= nightStart || now <= nightEnd;
    }
    return now >= nightStart && now <= nightEnd;
  }

  // ── Full observability pipeline (Steps 1-4 combined) ────────────────────
  function _computeObservability(id, date) {
    const look = _getLookAngles(id, date);
    if (!look) return { visible: false, reason: 'no_look_angles' };

    const elevDeg = look.elevation;
    const aboveHorizon = elevDeg > MIN_ELEVATION_DEG;

    const groundDark = _isGroundDark(date);
    const illuminated = _isIlluminated(look.posEci, date);

    return {
      visible:      aboveHorizon && groundDark === true && illuminated,
      elevation:    elevDeg,
      azimuth:      look.azimuth,
      rangeSat:     look.rangeSat,
      aboveHorizon,
      groundDark,   // true | false | null (SunCalc unavailable)
      illuminated,
      reason: !aboveHorizon ? 'below_horizon'
            : groundDark === false ? 'sky_too_bright'
            : !illuminated ? 'satellite_eclipsed'
            : 'visible',
    };
  }

  // ── Pass prediction (scan next 2 orbits in 30-s steps) ──────────────────
  function _computePasses() {
    const passes = {};
    if (myLat === null) return passes;
    const now = new Date();

    for (const id of activeSatIds) {
      const cat = SATELLITE_CATALOG[id];
      const sat = satellites[id];
      if (!cat) continue;

      // Calculated mode: scan for observable windows
      if (mode === 'calculated' && satrec[id]) {
        const windowSec = cat.period * 60 * 2; // scan 2 orbital periods
        let bestEta = null, bestEl = -Infinity;
        for (let dt = 0; dt < windowSec; dt += 30) {
          const t   = new Date(now.getTime() + dt * 1000);
          const obs = _computeObservability(id, t);
          if (obs.visible && obs.elevation > bestEl) {
            bestEl  = obs.elevation;
            bestEta = dt / 60; // minutes from now
          }
        }
        passes[id] = {
          etaMin:    bestEta !== null ? Math.round(bestEta) : null,
          maxEl:     bestEl > 0 ? bestEl : null,
          satName:   cat.short,
          hasWindow: bestEta !== null,
        };
      } else {
        // Live/demo mode: simple haversine proximity estimate
        if (!sat) continue;
        let minDist = Infinity, minTime = 0;
        const demoA = demoAngles[id] || 0;
        for (let t = 0; t <= cat.period * 2; t += 0.5) {
          const f    = t / cat.period;
          const fLat = cat.inc * Math.sin(demoA + f * 2 * Math.PI) * 180 / Math.PI;
          const fLon = ((( sat.lon||0 ) + f * 360) + 540) % 360 - 180;
          const d    = _haversine(myLat, myLon, fLat, fLon);
          if (d < minDist) { minDist = d; minTime = t; }
        }
        passes[id] = { etaMin: Math.round(minTime), distKm: Math.round(minDist), satName: cat.short, hasWindow: false };
      }
    }
    return passes;
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  MODE B — LIVE API (wheretheiss.at)
  // ══════════════════════════════════════════════════════════════════════════
  async function _tickLive() {
    const updates = {};
    let anyLive   = false;

    for (const id of activeSatIds) {
      let data = null;
      if (id === 25544) { // only ISS has a free real-time endpoint
        try {
          const r = await fetch(WHERETHEISS_BASE + id);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          data = await r.json();
          anyLive = true;
        } catch(e) { /* fall through to sim */ }
      }

      if (!data) data = _kinematicSim(id);
      if (!data)  continue;

      if (!satellites[id]) satellites[id] = { trail: [], orbit: [] };
      const sat = satellites[id];
      Object.assign(sat, {
        lat:        data.latitude  ?? data.lat,
        lon:        data.longitude ?? data.lon,
        alt:        data.altitude  ?? data.alt,
        velocity:   data.velocity,
        footprint:  data.footprint,
        visibility: data.visibility,
        observability: null, // not available in live mode
      });
      sat.trail.push([sat.lat, sat.lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      _computeOrbit(id);
      updates[id] = { ...sat, id, catalog: SATELLITE_CATALOG[id] };
    }

    const newStatus = anyLive ? 'live' : 'demo';
    if (newStatus !== statusState) { statusState = newStatus; emit('status', newStatus); }

    if (Object.keys(updates).length) {
      emit('update', { satellites: updates, pov: currentPOV, myLat, myLon, mode });
    }
    if (myLat !== null) emit('passes', _computePasses());
  }

  // ── Shared helpers ─────────────────────────────────────────────────────
  function _kinematicSim(id) {
    const cat = SATELLITE_CATALOG[id];
    if (!cat) return null;
    demoAngles[id] = (demoAngles[id] || 0) + 0.00014 * (92.68 / cat.period);
    const a   = demoAngles[id];
    const inc = cat.inc * Math.PI / 180;
    const lat = Math.asin(Math.sin(inc) * Math.sin(a)) * 180 / Math.PI;
    const lon = ((a * 180 / Math.PI + id * 37.3) % 360 + 360) % 360 - 180;
    return {
      latitude:   lat, longitude: lon,
      lat,        lon,
      altitude:   cat.alt + Math.sin(a * 3) * 2, alt: cat.alt,
      velocity:   cat.alt < 600 ? 27600 : 26400,
      footprint:  cat.alt * 10.8,
      visibility: lat > 0 ? 'daylight' : 'eclipsed',
    };
  }

  function _computeOrbit(id) {
    const cat = SATELLITE_CATALOG[id];
    const sat = satellites[id];
    if (!cat || !sat) return;
    const orbit = [];
    const lon   = sat.lon || 0;
    const drift = (cat.period / (24 * 60)) * 360;
    for (let i = 0; i <= cat.period * 2; i += 1.5) {
      const f    = i / cat.period;
      const oLat = cat.inc * Math.sin(f * 2 * Math.PI);
      const oLon = ((lon + f * 360 - f * drift * 0.5) + 540) % 360 - 180;
      orbit.push([oLat, oLon]);
    }
    sat.orbit = orbit;
  }

  function _getNearby(lat, lon, radiusKm = 3000) {
    return Object.keys(SATELLITE_CATALOG).map(Number)
      .map(id => {
        const sat = satellites[id]; if (!sat) return null;
        return { id, dist: _haversine(lat, lon, sat.lat, sat.lon), ...sat, catalog: SATELLITE_CATALOG[id] };
      })
      .filter(s => s && s.dist <= radiusKm)
      .sort((a, b) => a.dist - b.dist);
  }

  function _haversine(a, b, c, d) {
    const R  = EARTH_RADIUS_KM;
    const dL = (c - a) * Math.PI / 180;
    const dG = (d - b) * Math.PI / 180;
    const x  = Math.sin(dL/2)**2 + Math.cos(a*Math.PI/180) * Math.cos(c*Math.PI/180) * Math.sin(dG/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  // ── Public surface ─────────────────────────────────────────────────────
  return {
    start, stop, on,
    setMode, getMode,
    setPOV, setLocation,
    getSatellites, getData, isDemoMode,
    getPOV, getPOVModes,
    getOrbitProgress, getOrbitProgressById,
    getPassETA, getNearby,
    haversine: _haversine,
    // Expose physics helpers for notifications.js
    getLookAngles:       _getLookAngles,
    isIlluminated:       (posEci, date) => _isIlluminated(posEci, date),
    isGroundDark:        _isGroundDark,
    computeObservability: _computeObservability,
    MIN_ELEVATION_DEG,
  };
})();
