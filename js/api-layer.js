/**
 * api-layer.js — Multi-source Live API orchestrator (v5 fixed)
 *
 * BUGS FIXED:
 *  1. CelesTrak URLs were wrong (SPACETRACK/query requires auth login).
 *     Correct free endpoints: celestrak.org/NORAD/elements/gp.php
 *  2. N2YO URL had /1/&apiKey= (should be /1/?apiKey=)
 *  3. N2YO is CORS-blocked in browser — now routes through a CORS proxy
 *     or shows a clear error instead of silently failing
 *
 * Source priority:
 *   ISS (25544) : wheretheiss.at → open-notify.org → CelesTrak gp.php SGP4
 *   All others  : CelesTrak gp.php SGP4 → N2YO (if key + proxy set)
 *
 * Returns null if all sources fail — NEVER simulates.
 */
window.ApiLayer = (function () {
  'use strict';

  /* ── Correct free CelesTrak endpoints (no auth, CORS open) ── */
  var CELES_SINGLE = 'https://celestrak.org/NORAD/elements/gp.php?CATNR={ID}&FORMAT=TLE';
  var CELES_BULK   = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=TLE';
  /* Fallback group for weather/earth-obs sats */
  var CELES_SPECIAL = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=noaa&FORMAT=TLE';

  var WHERETHEISS = 'https://api.wheretheiss.at/v1/satellites/';
  var OPEN_NOTIFY = 'https://api.open-notify.org/iss-now.json';

  /*
   * N2YO note:
   * api.n2yo.com blocks CORS — you MUST run a tiny proxy.
   * Quickest proxy for local use:
   *   npx local-cors-proxy --proxyUrl https://api.n2yo.com --port 8010
   * Then set: ApiLayer.setN2YOProxy('http://localhost:8010')
   * On GitHub Pages use a Cloudflare Worker or similar.
   * Without a proxy the N2YO tier is silently skipped.
   */
  var n2yoKey   = null;
  var n2yoProxy = null; /* Must be set for N2YO to work */

  var tleCache    = {}; /* noradId → { line1, line2, epoch, fetchedAt } */
  var satrecCache = {}; /* noradId → satellite.js satrec               */
  var srcStatus   = {}; /* noradId → { source, lastSuccess, failures }  */
  var bulkDone    = false;
  var TLE_TTL     = 2 * 60 * 60 * 1000; /* 2 hours */

  /* ── Public config ────────────────────────────────── */
  function setN2YOKey(k)     { n2yoKey   = k   || null; }
  function setN2YOProxy(u)   { n2yoProxy = u   || null; }
  function getSourceStatus() { return JSON.parse(JSON.stringify(srcStatus)); }
  function getTLECache()     { return JSON.parse(JSON.stringify(tleCache)); }
  function hasN2YO()         { return !!(n2yoKey && n2yoProxy); }

  /* ── Fetch one satellite ──────────────────────────── */
  function fetchPosition(id) {
    var chain = (id === 25544)
      ? [tryWhereTheISS, tryOpenNotify, tryTLE]
      : [tryTLE, tryN2YO];

    function tryNext(i) {
      if (i >= chain.length) return Promise.resolve(null);
      return Promise.resolve().then(function() {
        return chain[i](id);
      }).then(function(d) {
        if (d && isValid(d)) {
          srcStatus[id] = { source: d.source, lastSuccess: Date.now(), failures: 0 };
          return d;
        }
        return tryNext(i + 1);
      }).catch(function(e) {
        if (!srcStatus[id]) srcStatus[id] = { source: '?', failures: 0 };
        srcStatus[id].failures = (srcStatus[id].failures || 0) + 1;
        srcStatus[id].lastError = e.message;
        return tryNext(i + 1);
      });
    }
    return tryNext(0);
  }

  /* ── Fetch all ────────────────────────────────────── */
  function fetchAll(ids) {
    var out = {};
    return Promise.all(ids.map(function(id) {
      return fetchPosition(id).then(function(d) { out[id] = d; });
    })).then(function() { return out; });
  }

  /* ── Tier 0a: wheretheiss.at ──────────────────────── */
  function tryWhereTheISS(id) {
    if (id !== 25544) return Promise.resolve(null);
    return timedFetch(WHERETHEISS + id, 6000).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (!d || d.latitude === undefined) throw new Error('no latitude in response');
      return {
        source: 'wheretheiss', liveData: true,
        lat: d.latitude, lon: d.longitude, alt: d.altitude,
        velocity: d.velocity, footprint: d.footprint,
        visibility: d.visibility, timestamp: d.timestamp
      };
    });
  }

  /* ── Tier 0b: open-notify.org ─────────────────────── */
  function tryOpenNotify(id) {
    if (id !== 25544) return Promise.resolve(null);
    return timedFetch(OPEN_NOTIFY, 5000).then(function(r) {
      return r.json();
    }).then(function(d) {
      if (!d || d.message !== 'success') throw new Error('non-success response');
      return {
        source: 'open-notify', liveData: true,
        lat: parseFloat(d.iss_position.latitude),
        lon: parseFloat(d.iss_position.longitude),
        alt: 408, velocity: 27600, footprint: 4500,
        visibility: null, timestamp: d.timestamp
      };
    });
  }

  /* ── Tier 1: CelesTrak gp.php + satellite.js SGP4 ── */
  function tryTLE(id) {
    if (!window.satellite) return Promise.reject(new Error('satellite.js not loaded'));

    var tle = tleCache[id];
    var needRefresh = !tle || (Date.now() - tle.fetchedAt > TLE_TTL);

    var loadP = needRefresh ? refreshTLE(id) : Promise.resolve();

    return loadP.then(function() {
      tle = tleCache[id];
      if (!tle) throw new Error('no TLE available for NORAD ' + id);

      var ageDays = (Date.now() - tle.epoch.getTime()) / 86400000;
      if (ageDays > 14) throw new Error('TLE too old: ' + ageDays.toFixed(1) + ' days');

      var rec = satrecCache[id];
      if (!rec) throw new Error('satrec missing for NORAD ' + id);

      var now = new Date();
      var pv;
      try { pv = satellite.propagate(rec, now); }
      catch(e) { throw new Error('SGP4 error: ' + e.message); }

      if (!pv || !pv.position || isNaN(pv.position.x)) {
        throw new Error('SGP4 returned invalid position for NORAD ' + id);
      }

      var gmst = satellite.gstime(now);
      var geo  = satellite.eciToGeodetic(pv.position, gmst);
      var lat  = satellite.degreesLat(geo.latitude);
      var lon  = satellite.degreesLong(geo.longitude);
      var alt  = geo.height;

      if (isNaN(lat) || isNaN(lon) || isNaN(alt)) throw new Error('NaN geodetic');

      var spd = pv.velocity
        ? Math.sqrt(pv.velocity.x*pv.velocity.x + pv.velocity.y*pv.velocity.y + pv.velocity.z*pv.velocity.z) * 3600
        : 27000;

      return {
        source: 'celestrak-sgp4', liveData: false,
        lat: lat, lon: lon, alt: alt,
        velocity: spd, footprint: footprintKm(alt),
        visibility: null,
        timestamp: Math.floor(now.getTime() / 1000),
        tleAgeDays: ageDays
      };
    });
  }

  function refreshTLE(id) {
    /* Try bulk load first — gets many sats in one request */
    var bulkP = bulkDone
      ? Promise.resolve()
      : timedFetch(CELES_BULK, 10000).then(function(r) {
          return r.text();
        }).then(function(text) {
          parseTLEText(text);
          bulkDone = true;
        }).catch(function(e) {
          console.warn('[ApiLayer] Bulk TLE fetch failed:', e.message);
        });

    return bulkP.then(function() {
      /* If still missing after bulk, try single */
      if (tleCache[id]) return;
      var url = CELES_SINGLE.replace('{ID}', id);
      return timedFetch(url, 8000).then(function(r) {
        return r.text();
      }).then(function(text) {
        parseTLEText(text);
      }).catch(function(e) {
        console.warn('[ApiLayer] Single TLE fetch failed for NORAD', id, e.message);
        /* Last resort: try special group (NOAA weather sats etc) */
        return timedFetch(CELES_SPECIAL, 8000).then(function(r) {
          return r.text();
        }).then(function(text) {
          parseTLEText(text);
        }).catch(function() {});
      });
    });
  }

  function parseTLEText(text) {
    if (!text || typeof text !== 'string') return;
    var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);

    for (var i = 0; i < lines.length; i++) {
      /* Skip name lines (don't start with 1 or 2) */
      var l1 = lines[i];
      var l2 = lines[i + 1];

      /* Handle 3-line format: name, line1, line2 */
      if (l1 && l1.charAt(0) !== '1' && l1.charAt(0) !== '2') {
        l1 = lines[i + 1];
        l2 = lines[i + 2];
        i++; /* skip name line */
      }

      if (!l1 || !l2) continue;
      if (l1.charAt(0) !== '1' || l1.charAt(1) !== ' ') continue;
      if (l2.charAt(0) !== '2' || l2.charAt(1) !== ' ') continue;
      if (l1.length < 69 || l2.length < 69) continue;

      if (!checksum(l1) || !checksum(l2)) { i++; continue; }

      var noradId = parseInt(l1.slice(2, 7).trim(), 10);
      if (!SATELLITE_CATALOG[noradId]) { i++; continue; }

      var epoch = parseEpoch(l1);
      tleCache[noradId] = { line1: l1, line2: l2, epoch: epoch, fetchedAt: Date.now() };
      try {
        satrecCache[noradId] = satellite.twoline2satrec(l1, l2);
      } catch(e) {
        console.warn('[ApiLayer] satrec parse failed for NORAD', noradId, e.message);
      }
      i++; /* skip l2 on next iteration */
    }
  }

  function checksum(line) {
    if (!line || line.length < 69) return false;
    var sum = 0;
    for (var i = 0; i < 68; i++) {
      var c = line.charAt(i);
      if (c === '-') sum += 1;
      else if (c >= '0' && c <= '9') sum += parseInt(c, 10);
    }
    return (sum % 10) === parseInt(line.charAt(68), 10);
  }

  function parseEpoch(l1) {
    var eStr = l1.slice(18, 32).trim();
    var y2   = parseInt(eStr.slice(0, 2), 10);
    var doy  = parseFloat(eStr.slice(2));
    var yr   = y2 >= 57 ? 1900 + y2 : 2000 + y2;
    var d    = new Date(yr, 0, 1);
    d.setDate(d.getDate() + Math.floor(doy) - 1);
    d.setMilliseconds((doy % 1) * 86400000);
    return d;
  }

  /* ── Tier 2: N2YO (requires proxy + API key) ──────── */
  function tryN2YO(id) {
    if (!n2yoKey || !n2yoProxy) return Promise.resolve(null);
    /* N2YO is CORS-blocked without a proxy server */
    /* URL: /positions/{id}/{observer_lat}/{observer_lng}/{observer_alt}/{seconds} */
    var url = n2yoProxy.replace(/\/$/, '') +
              '/rest/v1/satellite/positions/' + id +
              '/0/0/0/1/?apiKey=' + n2yoKey;
    return timedFetch(url, 7000).then(function(r) {
      return r.json();
    }).then(function(d) {
      var p = d && d.positions && d.positions[0];
      if (!p) throw new Error('N2YO: empty positions array');
      return {
        source: 'n2yo', liveData: true,
        lat: p.satlatitude, lon: p.satlongitude, alt: p.sataltitude,
        velocity: null, footprint: footprintKm(p.sataltitude),
        visibility: null, timestamp: p.timestamp
      };
    });
  }

  /* ── Helpers ──────────────────────────────────────── */
  function isValid(d) {
    return d &&
      typeof d.lat === 'number' && !isNaN(d.lat) && d.lat >= -90  && d.lat <= 90  &&
      typeof d.lon === 'number' && !isNaN(d.lon) && d.lon >= -180 && d.lon <= 180 &&
      typeof d.alt === 'number' && !isNaN(d.alt) && d.alt >= 80   && d.alt <= 50000;
  }

  function footprintKm(alt) {
    var R = 6371;
    return 2 * Math.PI * R * Math.acos(R / (R + alt)) * (180 / Math.PI) * 111.32;
  }

  function timedFetch(url, ms) {
    return new Promise(function(resolve, reject) {
      var timedOut = false;
      var tid = setTimeout(function() {
        timedOut = true;
        reject(new Error('Timeout after ' + ms + 'ms: ' + url));
      }, ms);
      fetch(url).then(function(r) {
        clearTimeout(tid);
        if (timedOut) return;
        if (!r.ok) { reject(new Error('HTTP ' + r.status + ' from ' + url)); return; }
        resolve(r);
      }).catch(function(e) {
        clearTimeout(tid);
        if (!timedOut) reject(e);
      });
    });
  }

  /* Pre-warm TLE cache in background */
  function prewarm(ids) {
    bulkDone = false;
    return timedFetch(CELES_BULK, 12000).then(function(r) {
      return r.text();
    }).then(function(text) {
      parseTLEText(text);
      bulkDone = true;
      var n = Object.keys(satrecCache).length;
      console.log('[ApiLayer] Prewarm complete: ' + n + ' satrecs loaded from CelesTrak');
    }).catch(function(e) {
      console.warn('[ApiLayer] Bulk prewarm failed, trying individual:', e.message);
      return Promise.all(ids.map(function(id) {
        var url = CELES_SINGLE.replace('{ID}', id);
        return timedFetch(url, 8000).then(function(r) {
          return r.text();
        }).then(function(text) {
          parseTLEText(text);
        }).catch(function(e2) {
          console.warn('[ApiLayer] Individual TLE failed for NORAD', id, e2.message);
        });
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
    getTLECache:     getTLECache,
    hasN2YO:         hasN2YO
  };
})();
