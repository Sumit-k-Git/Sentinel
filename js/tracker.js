/**
 * tracker.js  —  Dual-mode satellite tracker (v5)
 *
 * LIVE MODE      Uses ApiLayer → wheretheiss.at / open-notify / CelesTrak TLE
 *                All 10 catalogued satellites tracked with real positions.
 *                NO automatic fallback to simulation.  If data is unavailable,
 *                the satellite is marked offline and rendered differently.
 *
 * CALCULATED MODE  CelesTrak TLE + satellite.js SGP4 with strict TLE validation.
 *                  Refuses to render if TLE is stale (>14 days) or checksum fails.
 *
 * DEMO MODE      Explicit opt-in only (user toggle in control panel).
 *                Kinematic simulation — labelled clearly as "DEMO".
 *
 * All modes emit identical { satellites, pov, myLat, myLon, mode } update events.
 */

window.Tracker = (function () {
  'use strict';

  const EARTH_R        = 6371.0;
  const MIN_ELEV_DEG   = 15;
  const REFRESH_LIVE   = 5000;   // ms
  const REFRESH_CALC   = 2000;   // ms
  const TLE_TTL        = 2 * 60 * 60 * 1000;

  // ── State ────────────────────────────────────────────────────────────────
  let _mode          = 'live';   // 'live' | 'calculated' | 'demo'
  let _satellites    = {};       // noradId → SatState
  let _tleStore      = {};       // noradId → { line1, line2, epoch, fetchedAt }
  let _satrecStore   = {};       // noradId → satellite.js satrec
  let _timer         = null;
  let _myLat         = null;
  let _myLon         = null;
  let _demoAngles    = {};
  let _listeners     = {};
  let _currentPOV    = 'my_location';
  let _activeSatIds  = Object.keys(SATELLITE_CATALOG).map(Number);
  let _statusState   = 'acquiring';

  Object.keys(SATELLITE_CATALOG).forEach(id => {
    _demoAngles[id] = Math.random() * Math.PI * 2;
  });

  // ── Event bus ────────────────────────────────────────────────────────────
  function on(e, fn)    { (_listeners[e] = _listeners[e] || []).push(fn); }
  function _emit(e, d)  { (_listeners[e] || []).forEach(f => f(d)); }

  // ── Public API ────────────────────────────────────────────────────────────
  function setMode(m) {
    if (!['live','calculated','demo'].includes(m)) return;
    _mode = m;
    stop();
    if (m === 'live') {
      // Pre-warm TLE cache so CelesTrak fallback is ready immediately
      ApiLayer.prewarm(_activeSatIds);
    }
    start();
    _emit('mode_changed', { mode: m });
    _emit('status', m === 'demo' ? 'demo' : m === 'calculated' ? 'calculated' : 'acquiring');
    console.log('[Tracker] Mode →', m);
  }

  function getMode()              { return _mode; }
  function setPOV(pov) {
    _currentPOV = pov;
    _activeSatIds = (pov === 'my_location' || pov === 'global')
      ? Object.keys(SATELLITE_CATALOG).map(Number)
      : [parseInt(pov)];
    _emit('pov_changed', { pov, activeSatIds: _activeSatIds });
  }
  function setLocation(la, lo)    { _myLat = la; _myLon = lo; }
  function getSatellites()        { return _satellites; }
  function getData()              { return _satellites[25544] || {}; }
  function isDemoMode()           { return _mode === 'demo'; }
  function getPOV()               { return _currentPOV; }
  function getPOVModes()          { return { MY_LOCATION:'my_location', GLOBAL:'global' }; }
  function getOrbitProgress(id)   {
    const cat = SATELLITE_CATALOG[id || 25544];
    return cat ? ((Date.now()/1000) % (cat.period*60)) / (cat.period*60) : 0;
  }
  function getOrbitProgressById(id) { return getOrbitProgress(id); }
  function getNearby(la, lo, r)   { return _getNearby(la, lo, r); }
  function getPassETA()           { return _computePasses(); }
  function haversine(a,b,c,d)     { return _haversine(a,b,c,d); }
  function getLookAngles(id, date){ return _getLookAngles(id, date); }
  function isGroundDark(date)     { return _isGroundDark(date); }
  function computeObservability(id, date) { return _computeObservability(id, date); }
  function getTLEStatus()         {
    // Return TLE health summary for UI
    const status = {};
    for (const id of _activeSatIds) {
      const tle = _tleStore[id];
      if (!tle) { status[id] = { ok: false, reason: 'no_tle' }; continue; }
      const ageDays = (Date.now() - tle.epoch.getTime()) / 86400000;
      status[id] = {
        ok:       ageDays < 14,
        ageDays:  ageDays.toFixed(1),
        epoch:    tle.epoch.toISOString(),
        fresh:    ageDays < 2,
        stale:    ageDays >= 7 && ageDays < 14,
        expired:  ageDays >= 14,
      };
    }
    return status;
  }

  // ── Start / Stop ──────────────────────────────────────────────────────────
  function start() {
    stop();
    if (_mode === 'calculated') {
      _loadAllTLEs().then(() => {
        _tickCalc();
        _timer = setInterval(_tickCalc, REFRESH_CALC);
      });
    } else if (_mode === 'live') {
      _tickLive();
      _timer = setInterval(_tickLive, REFRESH_LIVE);
    } else {
      // demo
      _tickDemo();
      _timer = setInterval(_tickDemo, REFRESH_LIVE);
    }
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  LIVE MODE
  // ══════════════════════════════════════════════════════════════════════════
  async function _tickLive() {
    const results = await ApiLayer.fetchAll(_activeSatIds);
    let liveCount = 0, offlineCount = 0;

    for (const [idStr, data] of Object.entries(results)) {
      const id  = parseInt(idStr);
      const cat = SATELLITE_CATALOG[id];
      if (!cat) continue;

      if (!data) {
        // Mark offline — do NOT simulate
        offlineCount++;
        if (!_satellites[id]) _satellites[id] = {};
        _satellites[id].offline = true;
        _satellites[id].liveData = false;
        continue;
      }

      liveCount++;
      if (!_satellites[id]) _satellites[id] = { trail: [], orbit: [] };
      const sat = _satellites[id];

      Object.assign(sat, data, { offline: false });
      sat.trail = sat.trail || [];
      sat.trail.push([data.lat, data.lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      _computeOrbit(id);
    }

    const newStatus = liveCount > 0 ? 'live' : 'data_unavailable';
    if (newStatus !== _statusState) {
      _statusState = newStatus;
      _emit('status', newStatus);
    }

    const sourceStatus = ApiLayer.getSourceStatus();
    _emit('update', {
      satellites: _satellites,
      pov: _currentPOV,
      myLat: _myLat, myLon: _myLon,
      mode: _mode,
      liveCount,
      offlineCount,
      sourceStatus,
    });
    if (_myLat !== null) _emit('passes', _computePasses());
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  CALCULATED MODE  (SGP4 — strict TLE validation)
  // ══════════════════════════════════════════════════════════════════════════
  async function _loadAllTLEs() {
    const apiTLEs = ApiLayer.getTLECache();
    // Absorb any already-loaded TLEs from the API layer
    for (const [id, tle] of Object.entries(apiTLEs)) {
      _tleStore[id] = tle;
      try { _satrecStore[id] = satellite.twoline2satrec(tle.line1, tle.line2); }
      catch(e) { console.warn('[Tracker/Calc] satrec failed for', id, e.message); }
    }
    // Fetch missing ones
    const missing = _activeSatIds.filter(id => !_tleStore[id]);
    if (missing.length > 0) await ApiLayer.prewarm(missing);
    // Re-absorb
    const freshTLEs = ApiLayer.getTLECache();
    for (const [id, tle] of Object.entries(freshTLEs)) {
      if (!_tleStore[id]) {
        _tleStore[id] = tle;
        try { _satrecStore[id] = satellite.twoline2satrec(tle.line1, tle.line2); }
        catch(e) { console.warn('[Tracker/Calc] satrec failed for', id, e.message); }
      }
    }
    const loadedCount = Object.keys(_satrecStore).length;
    console.log(`[Tracker/Calc] ${loadedCount}/${_activeSatIds.length} satrecords loaded`);
    _emit('status', loadedCount > 0 ? 'calculated' : 'tle_unavailable');
  }

  function _tickCalc() {
    const now = new Date();
    let successCount = 0;

    for (const id of _activeSatIds) {
      const cat = SATELLITE_CATALOG[id];
      if (!cat) continue;

      // TLE validation gate — hard reject stale/missing TLE
      const tle = _tleStore[id];
      if (!tle) {
        if (!_satellites[id]) _satellites[id] = {};
        _satellites[id].offline = true;
        _satellites[id].tleStatus = 'no_tle';
        continue;
      }
      const ageDays = (Date.now() - tle.epoch.getTime()) / 86400000;
      if (ageDays > 14) {
        if (!_satellites[id]) _satellites[id] = {};
        _satellites[id].offline = true;
        _satellites[id].tleStatus = 'expired';
        _satellites[id].tleAgeDays = ageDays;
        console.warn(`[Tracker/Calc] NORAD ${id} TLE expired (${ageDays.toFixed(1)}d) — hiding satellite`);
        continue;
      }

      const rec = _satrecStore[id];
      if (!rec) { continue; }

      // Propagate
      let pv;
      try { pv = satellite.propagate(rec, now); }
      catch(e) {
        console.warn(`[Tracker/Calc] propagate failed for ${id}:`, e.message);
        continue;
      }

      if (!pv || !pv.position || isNaN(pv.position.x)) {
        console.warn(`[Tracker/Calc] NaN/null position for NORAD ${id} — skipping`);
        if (!_satellites[id]) _satellites[id] = {};
        _satellites[id].offline = true;
        _satellites[id].tleStatus = 'propagation_error';
        continue;
      }

      const gmst   = satellite.gstime(now);
      const posGeo = satellite.eciToGeodetic(pv.position, gmst);
      const lat    = satellite.degreesLat(posGeo.latitude);
      const lon    = satellite.degreesLong(posGeo.longitude);
      const alt    = posGeo.height;

      if (isNaN(lat) || isNaN(lon) || isNaN(alt)) {
        console.warn(`[Tracker/Calc] NaN geodetic for NORAD ${id}`);
        continue;
      }

      const speed = pv.velocity
        ? Math.sqrt(pv.velocity.x**2 + pv.velocity.y**2 + pv.velocity.z**2) * 3600
        : (cat.alt < 600 ? 27600 : 26800);

      if (!_satellites[id]) _satellites[id] = { trail: [], orbit: [] };
      const sat = _satellites[id];

      Object.assign(sat, {
        lat, lon, alt,
        velocity:   speed,
        footprint:  _footprint(alt),
        visibility: _eclipseCheck(pv.position, now) ? 'eclipsed' : 'daylight',
        posEci:     pv.position,
        liveData:   false,
        offline:    false,
        tleStatus:  ageDays < 2 ? 'fresh' : ageDays < 7 ? 'good' : 'aging',
        tleAgeDays: ageDays,
      });

      sat.trail = sat.trail || [];
      sat.trail.push([lat, lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      _computeOrbit(id);

      if (_myLat !== null) {
        sat.observability = _computeObservability(id, now);
      }
      successCount++;
    }

    _emit('update', {
      satellites: _satellites,
      pov: _currentPOV,
      myLat: _myLat, myLon: _myLon,
      mode: _mode,
      liveCount: successCount,
    });
    if (_myLat !== null) _emit('passes', _computePasses());
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  DEMO MODE  (explicit kinematic simulation)
  // ══════════════════════════════════════════════════════════════════════════
  function _tickDemo() {
    for (const id of _activeSatIds) {
      const cat = SATELLITE_CATALOG[id];
      if (!cat) continue;
      _demoAngles[id] = (_demoAngles[id] || 0) + 0.00014 * (92.68 / cat.period);
      const a   = _demoAngles[id];
      const inc = cat.inc * Math.PI / 180;
      const lat = Math.asin(Math.sin(inc) * Math.sin(a)) * 180 / Math.PI;
      const lon = ((a * 180 / Math.PI + id * 37.3) % 360 + 360) % 360 - 180;

      if (!_satellites[id]) _satellites[id] = { trail: [], orbit: [] };
      const sat = _satellites[id];
      Object.assign(sat, {
        lat, lon,
        alt:       cat.alt + Math.sin(a * 3) * 2,
        velocity:  cat.alt < 600 ? 27600 : 26800,
        footprint: _footprint(cat.alt),
        visibility: lat > 0 ? 'daylight' : 'eclipsed',
        liveData:  false,
        offline:   false,
        demo:      true,
        tleStatus: 'demo',
      });
      sat.trail.push([lat, lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      _computeOrbit(id);
    }

    _emit('update', {
      satellites: _satellites,
      pov: _currentPOV,
      myLat: _myLat, myLon: _myLon,
      mode: 'demo',
      liveCount: 0,
    });
    if (_myLat !== null) _emit('passes', _computePasses());
  }

  // ── Shared helpers ────────────────────────────────────────────────────────
  function _computeOrbit(id) {
    const cat = SATELLITE_CATALOG[id];
    const sat = _satellites[id];
    if (!cat || !sat || sat.lat === undefined) return;
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

  function _footprint(alt) {
    const R = EARTH_R;
    return 2 * Math.PI * R * Math.acos(R / (R + alt)) * (180 / Math.PI) * 111.32;
  }

  // ── Physics (Calculated mode) ─────────────────────────────────────────────
  function _eclipseCheck(posEci, date) {
    const sun = _sunECI(date);
    const sm  = Math.sqrt(sun.x**2 + sun.y**2 + sun.z**2);
    const su  = { x: sun.x/sm, y: sun.y/sm, z: sun.z/sm };
    const dot = posEci.x*su.x + posEci.y*su.y + posEci.z*su.z;
    if (dot > 0) return false;
    const perp = posEci.x**2 + posEci.y**2 + posEci.z**2 - dot**2;
    return perp < EARTH_R**2;
  }

  function _sunECI(date) {
    const JD  = date.getTime() / 86400000 + 2440587.5;
    const n   = JD - 2451545.0;
    const L   = (280.460 + 0.9856474 * n) % 360;
    const g   = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2*g)) * Math.PI / 180;
    const eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
    const R   = (1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2*g)) * 149597870.7;
    return { x: R*Math.cos(lam), y: R*Math.cos(eps)*Math.sin(lam), z: R*Math.sin(eps)*Math.sin(lam) };
  }

  function _getLookAngles(id, date) {
    if (!_satrecStore[id] || _myLat === null) return null;
    try {
      const pv   = satellite.propagate(_satrecStore[id], date || new Date());
      if (!pv?.position) return null;
      const gmst = satellite.gstime(date || new Date());
      const ecf  = satellite.eciToEcf(pv.position, gmst);
      const obs  = satellite.geodeticToEcf({
        latitude:  satellite.degreesToRadians(_myLat),
        longitude: satellite.degreesToRadians(_myLon),
        height:    0,
      });
      const look = satellite.ecfToLookAngles(obs, ecf);
      return {
        azimuth:   satellite.radiansToDegrees(look.azimuth),
        elevation: satellite.radiansToDegrees(look.elevation),
        rangeSat:  look.rangeSat,
        posEci:    pv.position,
      };
    } catch(e) { return null; }
  }

  function _isGroundDark(date) {
    if (!window.SunCalc || _myLat === null) return null;
    const times = SunCalc.getTimes(date, _myLat, _myLon);
    const now   = date.getTime();
    const nd    = times.nauticalDusk.getTime();
    const na    = times.nauticalDawn.getTime();
    return nd > na ? (now >= nd || now <= na) : (now >= nd && now <= na);
  }

  function _computeObservability(id, date) {
    const look = _getLookAngles(id, date);
    if (!look) return { visible: false, reason: 'no_look_angles' };
    const aboveHorizon = look.elevation > MIN_ELEV_DEG;
    const groundDark   = _isGroundDark(date);
    const illuminated  = !_eclipseCheck(look.posEci, date);
    return {
      visible:      aboveHorizon && groundDark === true && illuminated,
      elevation:    look.elevation, azimuth: look.azimuth,
      rangeSat:     look.rangeSat,
      aboveHorizon, groundDark, illuminated,
      reason: !aboveHorizon ? 'below_horizon'
            : groundDark === false ? 'sky_too_bright'
            : !illuminated ? 'satellite_eclipsed' : 'visible',
    };
  }

  function _computePasses() {
    const passes = {};
    if (_myLat === null) return passes;
    for (const id of _activeSatIds) {
      const cat = SATELLITE_CATALOG[id];
      const sat = _satellites[id];
      if (!cat) continue;
      if ((_mode === 'calculated') && _satrecStore[id]) {
        const now = new Date();
        let bestEta = null, bestEl = -Infinity;
        for (let dt = 0; dt < cat.period * 60 * 2; dt += 30) {
          const t   = new Date(now.getTime() + dt * 1000);
          const obs = _computeObservability(id, t);
          if (obs.visible && obs.elevation > bestEl) {
            bestEl = obs.elevation; bestEta = dt / 60;
          }
        }
        passes[id] = { etaMin: bestEta !== null ? Math.round(bestEta) : null, maxEl: bestEl > 0 ? bestEl : null, satName: cat.short, hasWindow: bestEta !== null };
      } else if (sat && sat.lat !== undefined) {
        let minDist = Infinity, minTime = 0;
        const a = _demoAngles[id] || 0;
        for (let t = 0; t <= cat.period * 2; t += 0.5) {
          const f = t / cat.period;
          const fl = cat.inc * Math.sin(a + f * 2 * Math.PI) * 180 / Math.PI;
          const fo = (((sat.lon || 0) + f * 360) + 540) % 360 - 180;
          const d  = _haversine(_myLat, _myLon, fl, fo);
          if (d < minDist) { minDist = d; minTime = t; }
        }
        passes[id] = { etaMin: Math.round(minTime), distKm: Math.round(minDist), satName: cat.short, hasWindow: false };
      }
    }
    return passes;
  }

  function _getNearby(lat, lon, r = 3000) {
    return Object.keys(SATELLITE_CATALOG).map(Number)
      .map(id => {
        const sat = _satellites[id];
        if (!sat || sat.offline || sat.lat === undefined) return null;
        return { id, dist: _haversine(lat, lon, sat.lat, sat.lon), ...sat, catalog: SATELLITE_CATALOG[id] };
      })
      .filter(s => s && s.dist <= r)
      .sort((a, b) => a.dist - b.dist);
  }

  function _haversine(a, b, c, d) {
    const R = EARTH_R, dL = (c-a)*Math.PI/180, dG = (d-b)*Math.PI/180;
    const x = Math.sin(dL/2)**2 + Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }

  return {
    start, stop, on,
    setMode, getMode, setPOV, setLocation,
    getSatellites, getData, isDemoMode,
    getPOV, getPOVModes,
    getOrbitProgress, getOrbitProgressById,
    getPassETA, getNearby, haversine,
    getLookAngles, isGroundDark,
    computeObservability, getTLEStatus,
    MIN_ELEVATION_DEG: MIN_ELEV_DEG,
  };
})();
