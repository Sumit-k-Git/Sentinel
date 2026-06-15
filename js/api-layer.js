/**
 * api-layer.js — Multi-source Live API orchestrator
 * Tier 0a: wheretheiss.at   (ISS only, no key, great CORS)
 * Tier 0b: open-notify.org  (ISS fallback, no key)
 * Tier 1 : CelesTrak TLE + satellite.js SGP4  (all sats, no key)
 * Tier 2 : N2YO              (all sats, free key optional)
 * Returns null — never simulates — if all sources fail.
 */
window.ApiLayer = (function () {
  'use strict';

  var WHERETHEISS   = 'https://api.wheretheiss.at/v1/satellites/';
  var OPEN_NOTIFY   = 'https://api.open-notify.org/iss-now.json';
  var CELES_SINGLE  = 'https://celestrak.org/SPACETRACK/query/class/gp/CATNR/{ID}/format/tle/';
  var CELES_BULK    = 'https://celestrak.org/SPACETRACK/query/class/gp/GROUP/stations/format/tle/';
  var TLE_TTL       = 2 * 60 * 60 * 1000;

  var n2yoKey     = null;
  var n2yoProxy   = null;
  var tleCache    = {};
  var satrecCache = {};
  var srcStatus   = {};
  var bulkLoaded  = false;

  /* ── Public config ─────────────────────────────────── */
  function setN2YOKey(k)     { n2yoKey = k || null; }
  function setN2YOProxy(u)   { n2yoProxy = u || null; }
  function getSourceStatus() { return JSON.parse(JSON.stringify(srcStatus)); }
  function getTLECache()     { return JSON.parse(JSON.stringify(tleCache)); }

  /* ── Fetch one satellite ───────────────────────────── */
  function fetchPosition(id) {
    var chain = (id === 25544)
      ? [tryWhereTheISS, tryOpenNotify, tryTLE]
      : [tryTLE, tryN2YO];

    function tryNext(i) {
      if (i >= chain.length) return Promise.resolve(null);
      return chain[i](id).then(function(d) {
        if (d && isValid(d)) {
          srcStatus[id] = { source: d.source, lastSuccess: Date.now(), failures: 0 };
          return d;
        }
        return tryNext(i + 1);
      }).catch(function(e) {
        if (!srcStatus[id]) srcStatus[id] = { failures: 0 };
        srcStatus[id].failures = (srcStatus[id].failures || 0) + 1;
        srcStatus[id].lastError = e.message;
        return tryNext(i + 1);
      });
    }
    return tryNext(0);
  }

  /* ── Fetch all ─────────────────────────────────────── */
  function fetchAll(ids) {
    var out = {};
    var promises = ids.map(function(id) {
      return fetchPosition(id).then(function(d) { out[id] = d; });
    });
    return Promise.all(promises).then(function() { return out; });
  }

  /* ── Tier 0a: wheretheiss.at ───────────────────────── */
  function tryWhereTheISS(id) {
    if (id !== 25544) return Promise.resolve(null);
    return timedFetch(WHERETHEISS + id, 6000).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (!d || d.latitude === undefined) throw new Error('bad response');
      return { source:'wheretheiss', liveData:true,
        lat:d.latitude, lon:d.longitude, alt:d.altitude,
        velocity:d.velocity, footprint:d.footprint,
        visibility:d.visibility, timestamp:d.timestamp };
    });
  }

  /* ── Tier 0b: open-notify.org ──────────────────────── */
  function tryOpenNotify(id) {
    if (id !== 25544) return Promise.resolve(null);
    return timedFetch(OPEN_NOTIFY, 5000).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (!d || d.message !== 'success') throw new Error('non-success');
      return { source:'open-notify', liveData:true,
        lat:parseFloat(d.iss_position.latitude),
        lon:parseFloat(d.iss_position.longitude),
        alt:408, velocity:27600, footprint:4500,
        visibility:null, timestamp:d.timestamp };
    });
  }

  /* ── Tier 1: CelesTrak TLE + SGP4 ─────────────────── */
  function tryTLE(id) {
    if (!window.satellite) return Promise.reject(new Error('satellite.js not loaded'));

    var needRefresh = !tleCache[id] || (Date.now() - tleCache[id].fetchedAt > TLE_TTL);
    var loadPromise = needRefresh ? refreshTLE(id) : Promise.resolve();

    return loadPromise.then(function() {
      var tle = tleCache[id];
      if (!tle) throw new Error('no TLE for ' + id);

      var ageDays = (Date.now() - tle.epoch.getTime()) / 86400000;
      if (ageDays > 14) throw new Error('TLE expired (' + ageDays.toFixed(1) + 'd)');

      var rec = satrecCache[id];
      if (!rec) throw new Error('no satrec for ' + id);

      var now = new Date();
      var pv;
      try { pv = satellite.propagate(rec, now); } catch(e) { throw new Error('SGP4 error: ' + e.message); }

      if (!pv || !pv.position || isNaN(pv.position.x)) throw new Error('SGP4 NaN position');

      var gmst = satellite.gstime(now);
      var geo  = satellite.eciToGeodetic(pv.position, gmst);
      var lat  = satellite.degreesLat(geo.latitude);
      var lon  = satellite.degreesLong(geo.longitude);
      var alt  = geo.height;

      if (isNaN(lat) || isNaN(lon) || isNaN(alt)) throw new Error('NaN geodetic');

      var spd = pv.velocity
        ? Math.sqrt(pv.velocity.x*pv.velocity.x + pv.velocity.y*pv.velocity.y + pv.velocity.z*pv.velocity.z) * 3600
        : 27000;

      return { source:'celestrak-tle', liveData:false,
        lat:lat, lon:lon, alt:alt, velocity:spd,
        footprint:footprintKm(alt), visibility:null,
        timestamp:Math.floor(Date.now()/1000), tleAgeDays:ageDays };
    });
  }

  function refreshTLE(id) {
    /* Try bulk first (gets all stations in one request) */
    if (!bulkLoaded) {
      return timedFetch(CELES_BULK, 9000).then(function(r) {
        return r.text();
      }).then(function(text) {
        parseTLEBlock(text);
        bulkLoaded = true;
        /* If still missing, try individual */
        if (!tleCache[id]) return fetchSingleTLE(id);
      }).catch(function() {
        return fetchSingleTLE(id);
      });
    }
    return fetchSingleTLE(id);
  }

  function fetchSingleTLE(id) {
    var url = CELES_SINGLE.replace('{ID}', id);
    return timedFetch(url, 8000).then(function(r) {
      return r.text();
    }).then(function(text) {
      parseTLEBlock(text);
    }).catch(function(e) {
      console.warn('[ApiLayer] single TLE fetch failed for', id, e.message);
    });
  }

  function parseTLEBlock(text) {
    var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length - 1; i++) {
      var l1 = lines[i], l2 = lines[i + 1];
      if (!l1 || !l2) continue;
      if (l1.charAt(0) !== '1' || l1.charAt(1) !== ' ') continue;
      if (l2.charAt(0) !== '2' || l2.charAt(1) !== ' ') continue;
      if (!tleChecksum(l1) || !tleChecksum(l2)) { i++; continue; }
      var id = parseInt(l1.slice(2, 7).trim(), 10);
      if (!SATELLITE_CATALOG[id]) { i++; continue; }
      var epoch = parseTLEEpoch(l1);
      tleCache[id] = { line1:l1, line2:l2, epoch:epoch, fetchedAt:Date.now() };
      try { satrecCache[id] = satellite.twoline2satrec(l1, l2); } catch(e) { console.warn('[ApiLayer] satrec failed', id, e.message); }
      i++;
    }
  }

  function tleChecksum(line) {
    if (!line || line.length < 69) return false;
    var sum = 0;
    for (var i = 0; i < 68; i++) {
      var c = line.charAt(i);
      if (c === '-') sum += 1;
      else if (c >= '0' && c <= '9') sum += parseInt(c, 10);
    }
    return (sum % 10) === parseInt(line.charAt(68), 10);
  }

  function parseTLEEpoch(l1) {
    var e   = l1.slice(18, 32).trim();
    var y2  = parseInt(e.slice(0, 2), 10);
    var doy = parseFloat(e.slice(2));
    var yr  = y2 >= 57 ? 1900 + y2 : 2000 + y2;
    var d   = new Date(yr, 0, 1);
    d.setDate(d.getDate() + Math.floor(doy) - 1);
    d.setMilliseconds((doy % 1) * 86400000);
    return d;
  }

  /* ── Tier 2: N2YO ──────────────────────────────────── */
  function tryN2YO(id) {
    if (!n2yoKey) return Promise.resolve(null);
    var base = n2yoProxy || 'https://api.n2yo.com/rest/v1/satellite';
    var url  = base + '/positions/' + id + '/0/0/0/1/&apiKey=' + n2yoKey;
    return timedFetch(url, 7000).then(function(r) {
      return r.json();
    }).then(function(d) {
      var p = d && d.positions && d.positions[0];
      if (!p) throw new Error('empty N2YO response');
      return { source:'n2yo', liveData:true,
        lat:p.satlatitude, lon:p.satlongitude, alt:p.sataltitude,
        velocity:null, footprint:footprintKm(p.sataltitude),
        visibility:null, timestamp:p.timestamp };
    });
  }

  /* ── Helpers ────────────────────────────────────────── */
  function isValid(d) {
    return d && typeof d.lat === 'number' && !isNaN(d.lat)
            && typeof d.lon === 'number' && !isNaN(d.lon)
            && typeof d.alt === 'number' && !isNaN(d.alt)
            && d.lat >= -90 && d.lat <= 90
            && d.lon >= -180 && d.lon <= 180
            && d.alt >= 80 && d.alt <= 50000;
  }

  function footprintKm(alt) {
    var R = 6371;
    return 2 * Math.PI * R * Math.acos(R / (R + alt)) * (180 / Math.PI) * 111.32;
  }

  function timedFetch(url, ms) {
    return new Promise(function(resolve, reject) {
      var done = false;
      var tid  = setTimeout(function() { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      fetch(url).then(function(r) {
        clearTimeout(tid);
        if (done) return;
        done = true;
        if (!r.ok) { reject(new Error('HTTP ' + r.status)); return; }
        resolve(r);
      }).catch(function(e) {
        clearTimeout(tid);
        if (!done) { done = true; reject(e); }
      });
    });
  }

  function prewarm(ids) {
    bulkLoaded = false; // force fresh bulk load
    return timedFetch(CELES_BULK, 10000).then(function(r) {
      return r.text();
    }).then(function(text) {
      parseTLEBlock(text);
      bulkLoaded = true;
      var n = Object.keys(satrecCache).length;
      console.log('[ApiLayer] Prewarm: ' + n + '/' + ids.length + ' satrecs loaded');
    }).catch(function(e) {
      console.warn('[ApiLayer] Bulk prewarm failed:', e.message);
      /* Try each individually */
      return Promise.all(ids.map(function(id) {
        return fetchSingleTLE(id).catch(function(){});
      }));
    });
  }

  return {
    fetchPosition:   fetchPosition,
    fetchAll:        fetchAll,
    prewarm:         prewarm,
    setN2YOKey:      setN2YOKey,
    setN2YOProxy:    setN2YOProxy,
    getSourceStatus: getSourceStatus,
    getTLECache:     getTLECache
  };
})();
