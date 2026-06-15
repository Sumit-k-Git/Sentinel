/**
 * tracker.js — Tri-mode tracker (v5)
 * LIVE       : ApiLayer multi-source polling
 * CALCULATED : CelesTrak TLE + satellite.js SGP4, strict validation
 * DEMO       : Kinematic simulation (explicit user opt-in only)
 *
 * All modes emit identical update events.  Renderer never knows which mode.
 * Satellites that have no data in Live/Calculated modes are marked offline
 * and rendered as ghosts — never silently simulated.
 */
window.Tracker = (function () {
  'use strict';

  var ER           = 6371;
  var MIN_EL       = 15;
  var REFRESH_LIVE = 5000;
  var REFRESH_CALC = 2000;
  var REFRESH_DEMO = 5000;

  /* ── State ──────────────────────────────────────────── */
  var _mode     = 'live';
  var _sats     = {};
  var _satrecs  = {};
  var _tles     = {};
  var _timer    = null;
  var _myLat    = null;
  var _myLon    = null;
  var _angles   = {};
  var _listeners = {};
  var _pov      = 'my_location';
  var _activeIds = Object.keys(SATELLITE_CATALOG).map(Number);
  var _status   = 'acquiring';

  Object.keys(SATELLITE_CATALOG).forEach(function(id) {
    _angles[id] = Math.random() * Math.PI * 2;
  });

  /* ── Event bus ──────────────────────────────────────── */
  function on(e, fn) {
    if (!_listeners[e]) _listeners[e] = [];
    _listeners[e].push(fn);
  }
  function emit(e, d) {
    var fns = _listeners[e] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](d); } catch(err) { console.error('[Tracker emit]', err); }
    }
  }
  function setStatus(s) {
    if (s !== _status) { _status = s; emit('status', s); }
  }

  /* ── Public API ─────────────────────────────────────── */
  function setMode(m) {
    if (['live','calculated','demo'].indexOf(m) === -1) return;
    stop();
    _mode = m;
    start();
    emit('mode_changed', { mode: m });
    var map = { live:'acquiring', calculated:'calculated', demo:'demo' };
    setStatus(map[m]);
  }

  function getMode()    { return _mode; }

  function setPOV(pov) {
    _pov = pov;
    _activeIds = (pov === 'my_location' || pov === 'global')
      ? Object.keys(SATELLITE_CATALOG).map(Number)
      : [parseInt(pov, 10)];
  }

  function setLocation(la, lo)    { _myLat = la; _myLon = lo; }
  function getSatellites()        { return _sats; }
  function getData()              { return _sats[25544] || {}; }
  function isDemoMode()           { return _mode === 'demo'; }
  function getPOV()               { return _pov; }
  function getPOVModes()          { return {}; }
  function haversine(a, b, c, d)  { return hav(a, b, c, d); }
  function getNearby(la, lo, r)   { return nearby(la, lo, r); }
  function getPassETA()           { return passes(); }

  function getOrbitProgress(id) {
    var cat = SATELLITE_CATALOG[id || 25544];
    if (!cat) return 0;
    return ((Date.now() / 1000) % (cat.period * 60)) / (cat.period * 60);
  }
  function getOrbitProgressById(id) { return getOrbitProgress(id); }

  function getTLEStatus() {
    var out = {};
    for (var i = 0; i < _activeIds.length; i++) {
      var id  = _activeIds[i];
      var tle = _tles[id];
      if (!tle) { out[id] = { ok: false, reason: 'no_tle', ageDays: '?' }; continue; }
      var age = (Date.now() - tle.epoch.getTime()) / 86400000;
      out[id] = { ok: age < 14, ageDays: age.toFixed(1),
        epoch: tle.epoch.toISOString(),
        fresh: age < 2, stale: age >= 7 && age < 14, expired: age >= 14 };
    }
    return out;
  }

  function getLookAngles(id, date)      { return lookAngles(id, date); }
  function isGroundDark(date)           { return groundDark(date); }
  function computeObservability(id, dt) { return observability(id, dt); }

  /* ── Start / Stop ───────────────────────────────────── */
  function start() {
    stop();
    if (_mode === 'live') {
      ApiLayer.prewarm(_activeIds); // background — don't await
      tickLive();
      _timer = setInterval(tickLive, REFRESH_LIVE);
    } else if (_mode === 'calculated') {
      loadTLEs().then(function() {
        tickCalc();
        _timer = setInterval(tickCalc, REFRESH_CALC);
      });
    } else {
      tickDemo();
      _timer = setInterval(tickDemo, REFRESH_DEMO);
    }
  }

  function stop() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  /* ── LIVE MODE ──────────────────────────────────────── */
  function tickLive() {
    ApiLayer.fetchAll(_activeIds).then(function(results) {
      var live = 0;
      Object.keys(results).forEach(function(idStr) {
        var id  = parseInt(idStr, 10);
        var data = results[id];
        if (!_sats[id]) _sats[id] = { trail: [], orbit: [] };
        var sat = _sats[id];
        if (!data) {
          sat.offline = true;
          return;
        }
        live++;
        sat.offline   = false;
        sat.lat       = data.lat;
        sat.lon       = data.lon;
        sat.alt       = data.alt;
        sat.velocity  = data.velocity;
        sat.footprint = data.footprint;
        sat.visibility = data.visibility || null;
        sat.source    = data.source;
        sat.liveData  = data.liveData;
        sat.tleAgeDays = data.tleAgeDays || null;
        sat.demo      = false;
        sat.trail.push([data.lat, data.lon]);
        if (sat.trail.length > 90) sat.trail.shift();
        computeOrbit(id);
      });
      setStatus(live > 0 ? 'live' : 'data_unavailable');
      emit('update', {
        satellites: _sats, pov: _pov,
        myLat: _myLat, myLon: _myLon,
        mode: _mode, liveCount: live,
        sourceStatus: ApiLayer.getSourceStatus()
      });
      if (_myLat !== null) emit('passes', passes());
    }).catch(function(e) {
      console.error('[Tracker/live]', e);
    });
  }

  /* ── CALCULATED MODE ────────────────────────────────── */
  function loadTLEs() {
    // Absorb anything already fetched by ApiLayer
    var cached = ApiLayer.getTLECache();
    Object.keys(cached).forEach(function(idStr) {
      var id  = parseInt(idStr, 10);
      var tle = cached[id];
      if (!_tles[id]) {
        _tles[id] = tle;
        if (!_satrecs[id] && window.satellite) {
          try { _satrecs[id] = satellite.twoline2satrec(tle.line1, tle.line2); } catch(e) {}
        }
      }
    });
    var missing = _activeIds.filter(function(id) { return !_satrecs[id]; });
    var p = missing.length > 0 ? ApiLayer.prewarm(missing) : Promise.resolve();
    return p.then(function() {
      var fresh = ApiLayer.getTLECache();
      Object.keys(fresh).forEach(function(idStr) {
        var id = parseInt(idStr, 10);
        if (!_tles[id]) {
          _tles[id] = fresh[id];
          if (window.satellite) {
            try { _satrecs[id] = satellite.twoline2satrec(fresh[id].line1, fresh[id].line2); } catch(e) {}
          }
        }
      });
      var n = Object.keys(_satrecs).length;
      setStatus(n > 0 ? 'calculated' : 'tle_unavailable');
    });
  }

  function tickCalc() {
    var now = new Date();
    var ok  = 0;
    for (var i = 0; i < _activeIds.length; i++) {
      var id  = _activeIds[i];
      var cat = SATELLITE_CATALOG[id];
      if (!cat) continue;
      if (!_sats[id]) _sats[id] = { trail: [], orbit: [] };
      var sat = _sats[id];

      var tle = _tles[id];
      if (!tle || !_satrecs[id]) {
        sat.offline = true; sat.tleStatus = 'no_tle'; continue;
      }
      var ageDays = (Date.now() - tle.epoch.getTime()) / 86400000;
      if (ageDays > 14) {
        sat.offline = true; sat.tleStatus = 'expired'; sat.tleAgeDays = ageDays; continue;
      }

      var pv;
      try { pv = satellite.propagate(_satrecs[id], now); } catch(e) {
        sat.offline = true; sat.tleStatus = 'error'; continue;
      }
      if (!pv || !pv.position || isNaN(pv.position.x)) {
        sat.offline = true; sat.tleStatus = 'nan'; continue;
      }

      var gmst = satellite.gstime(now);
      var geo  = satellite.eciToGeodetic(pv.position, gmst);
      var lat  = satellite.degreesLat(geo.latitude);
      var lon  = satellite.degreesLong(geo.longitude);
      var alt  = geo.height;
      if (isNaN(lat) || isNaN(lon) || isNaN(alt)) {
        sat.offline = true; sat.tleStatus = 'nan'; continue;
      }

      var spd = pv.velocity
        ? Math.sqrt(pv.velocity.x*pv.velocity.x + pv.velocity.y*pv.velocity.y + pv.velocity.z*pv.velocity.z) * 3600
        : 27000;

      sat.offline     = false;
      sat.lat         = lat;
      sat.lon         = lon;
      sat.alt         = alt;
      sat.velocity    = spd;
      sat.footprint   = footprintKm(alt);
      sat.visibility  = isEclipsed(pv.position, now) ? 'eclipsed' : 'daylight';
      sat.posEci      = pv.position;
      sat.liveData    = false;
      sat.demo        = false;
      sat.source      = 'sgp4';
      sat.tleStatus   = ageDays < 2 ? 'fresh' : ageDays < 7 ? 'good' : 'aging';
      sat.tleAgeDays  = ageDays;

      sat.trail.push([lat, lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      computeOrbit(id);
      if (_myLat !== null) sat.observability = observability(id, now);
      ok++;
    }

    emit('update', {
      satellites: _sats, pov: _pov,
      myLat: _myLat, myLon: _myLon,
      mode: _mode, liveCount: ok
    });
    if (_myLat !== null) emit('passes', passes());
  }

  /* ── DEMO MODE ──────────────────────────────────────── */
  function tickDemo() {
    for (var i = 0; i < _activeIds.length; i++) {
      var id  = _activeIds[i];
      var cat = SATELLITE_CATALOG[id];
      if (!cat) continue;
      _angles[id] = (_angles[id] || 0) + 0.00014 * (92.68 / cat.period);
      var a   = _angles[id];
      var inc = cat.inc * Math.PI / 180;
      var lat = Math.asin(Math.sin(inc) * Math.sin(a)) * 180 / Math.PI;
      var lon = ((a * 180 / Math.PI + id * 37.3) % 360 + 360) % 360 - 180;

      if (!_sats[id]) _sats[id] = { trail: [], orbit: [] };
      var sat = _sats[id];
      sat.offline    = false;
      sat.lat        = lat;
      sat.lon        = lon;
      sat.alt        = cat.alt + Math.sin(a * 3) * 2;
      sat.velocity   = cat.alt < 600 ? 27600 : 26800;
      sat.footprint  = footprintKm(cat.alt);
      sat.visibility = lat > 0 ? 'daylight' : 'eclipsed';
      sat.liveData   = false;
      sat.demo       = true;
      sat.source     = 'demo';
      sat.tleStatus  = 'demo';
      sat.tleAgeDays = null;

      sat.trail.push([lat, lon]);
      if (sat.trail.length > 90) sat.trail.shift();
      computeOrbit(id);
    }
    emit('update', {
      satellites: _sats, pov: _pov,
      myLat: _myLat, myLon: _myLon,
      mode: 'demo', liveCount: 0
    });
    if (_myLat !== null) emit('passes', passes());
  }

  /* ── Shared helpers ─────────────────────────────────── */
  function computeOrbit(id) {
    var cat = SATELLITE_CATALOG[id];
    var sat = _sats[id];
    if (!cat || !sat || sat.lat === undefined) return;
    var orbit = [];
    var lon   = sat.lon || 0;
    var drift = (cat.period / (24 * 60)) * 360;
    for (var i = 0; i <= cat.period * 2; i += 1.5) {
      var f = i / cat.period;
      orbit.push([cat.inc * Math.sin(f * 2 * Math.PI),
                  ((lon + f * 360 - f * drift * 0.5) + 540) % 360 - 180]);
    }
    sat.orbit = orbit;
  }

  function footprintKm(alt) {
    var R = ER;
    return 2 * Math.PI * R * Math.acos(R / (R + alt)) * (180 / Math.PI) * 111.32;
  }

  function sunECI(date) {
    var J   = date.getTime() / 86400000 + 2440587.5;
    var n   = J - 2451545;
    var L   = (280.46 + 0.9856474 * n) % 360;
    var g   = ((357.528 + 0.9856003 * n) % 360) * Math.PI / 180;
    var lam = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180;
    var eps = (23.439 - 0.0000004 * n) * Math.PI / 180;
    var R   = (1.00014 - 0.01671 * Math.cos(g)) * 149597870.7;
    return { x: R*Math.cos(lam), y: R*Math.cos(eps)*Math.sin(lam), z: R*Math.sin(eps)*Math.sin(lam) };
  }

  function isEclipsed(pos, date) {
    var s  = sunECI(date);
    var sm = Math.sqrt(s.x*s.x + s.y*s.y + s.z*s.z);
    var sx = s.x/sm, sy = s.y/sm, sz = s.z/sm;
    var dot = pos.x*sx + pos.y*sy + pos.z*sz;
    if (dot > 0) return false;
    var perp = pos.x*pos.x + pos.y*pos.y + pos.z*pos.z - dot*dot;
    return perp < ER * ER;
  }

  function lookAngles(id, date) {
    if (!_satrecs[id] || _myLat === null || !window.satellite) return null;
    try {
      var pv = satellite.propagate(_satrecs[id], date || new Date());
      if (!pv || !pv.position) return null;
      var gmst = satellite.gstime(date || new Date());
      var ecf  = satellite.eciToEcf(pv.position, gmst);
      var obs  = satellite.geodeticToEcf({
        latitude:  satellite.degreesToRadians(_myLat),
        longitude: satellite.degreesToRadians(_myLon),
        height: 0
      });
      var la = satellite.ecfToLookAngles(obs, ecf);
      return {
        azimuth:   satellite.radiansToDegrees(la.azimuth),
        elevation: satellite.radiansToDegrees(la.elevation),
        rangeSat:  la.rangeSat,
        posEci:    pv.position
      };
    } catch(e) { return null; }
  }

  function groundDark(date) {
    if (!window.SunCalc || _myLat === null) return null;
    var t   = SunCalc.getTimes(date, _myLat, _myLon);
    var now = date.getTime();
    var nd  = t.nauticalDusk.getTime();
    var na  = t.nauticalDawn.getTime();
    return nd > na ? (now >= nd || now <= na) : (now >= nd && now <= na);
  }

  function observability(id, date) {
    var look = lookAngles(id, date);
    if (!look) return { visible: false, reason: 'no_look_angles' };
    var above = look.elevation > MIN_EL;
    var dark  = groundDark(date);
    var lit   = !isEclipsed(look.posEci, date);
    return {
      visible:      above && dark === true && lit,
      elevation:    look.elevation,
      azimuth:      look.azimuth,
      rangeSat:     look.rangeSat,
      aboveHorizon: above,
      groundDark:   dark,
      illuminated:  lit,
      reason: !above ? 'below_horizon' : dark === false ? 'sky_bright' : !lit ? 'eclipsed' : 'visible'
    };
  }

  function passes() {
    var out = {};
    if (_myLat === null) return out;
    for (var i = 0; i < _activeIds.length; i++) {
      var id  = _activeIds[i];
      var cat = SATELLITE_CATALOG[id];
      var sat = _sats[id];
      if (!cat) continue;
      if (_mode === 'calculated' && _satrecs[id]) {
        var now = new Date();
        var eta = null, bestEl = -Infinity;
        for (var dt = 0; dt < cat.period * 60 * 2; dt += 30) {
          var t2  = new Date(now.getTime() + dt * 1000);
          var obs = observability(id, t2);
          if (obs.visible && obs.elevation > bestEl) { bestEl = obs.elevation; eta = dt / 60; }
        }
        out[id] = { etaMin: eta !== null ? Math.round(eta) : null, maxEl: bestEl > 0 ? bestEl : null, satName: cat.short, hasWindow: eta !== null };
      } else if (sat && sat.lat !== undefined && !sat.offline) {
        var md = Infinity, mt = 0, ang = _angles[id] || 0;
        for (var tt = 0; tt <= cat.period * 2; tt += 0.5) {
          var f  = tt / cat.period;
          var fl = cat.inc * Math.sin(ang + f * 2 * Math.PI) * 180 / Math.PI;
          var fo = (((sat.lon || 0) + f * 360) + 540) % 360 - 180;
          var d  = hav(_myLat, _myLon, fl, fo);
          if (d < md) { md = d; mt = tt; }
        }
        out[id] = { etaMin: Math.round(mt), distKm: Math.round(md), satName: cat.short, hasWindow: false };
      }
    }
    return out;
  }

  function nearby(la, lo, r) {
    r = r || 3000;
    return Object.keys(SATELLITE_CATALOG).map(Number).map(function(id) {
      var sat = _sats[id];
      if (!sat || sat.offline || sat.lat === undefined) return null;
      return { id: id, dist: hav(la, lo, sat.lat, sat.lon),
        lat: sat.lat, lon: sat.lon, alt: sat.alt,
        catalog: SATELLITE_CATALOG[id] };
    }).filter(function(s) { return s && s.dist <= r; })
      .sort(function(a, b) { return a.dist - b.dist; });
  }

  function hav(a, b, c, d) {
    var R  = ER;
    var dL = (c - a) * Math.PI / 180;
    var dG = (d - b) * Math.PI / 180;
    var x  = Math.sin(dL/2)*Math.sin(dL/2) +
              Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)*Math.sin(dG/2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  /* ── Public surface ─────────────────────────────────── */
  return {
    start: start, stop: stop, on: on,
    setMode: setMode, getMode: getMode,
    setPOV: setPOV, setLocation: setLocation,
    getSatellites: getSatellites, getData: getData,
    isDemoMode: isDemoMode, getPOV: getPOV, getPOVModes: getPOVModes,
    getOrbitProgress: getOrbitProgress,
    getOrbitProgressById: getOrbitProgressById,
    getPassETA: getPassETA, getNearby: getNearby,
    haversine: haversine,
    getLookAngles: getLookAngles, isGroundDark: isGroundDark,
    computeObservability: computeObservability,
    getTLEStatus: getTLEStatus,
    MIN_ELEVATION_DEG: MIN_EL
  };
})();
