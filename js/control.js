/**
 * control.js — Control panel (v5)
 * Three-button mode switcher: Live | Calculated | Demo
 * Source status panel, TLE health, observability grid, N2YO key input.
 */
(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  var myLat = null, myLon = null;
  var currentPOV = 'my_location';
  var bc = null;
  var telQ = [], lastTelFlush = 0;
  var mapCanvas, mapCtx, mapW, mapH;
  var t0 = performance.now();
  var deferredInstall = null;

  try { bc = new BroadcastChannel('sentinel_ctrl'); } catch(e) {}
  function bcast(d) { try { if (bc) bc.postMessage(d); } catch(e) {} }

  /* ── BOOT ──────────────────────────────────────────── */
  function boot() {
    var ids = ['bl1','bl2','bl3','bl4'];
    ids.forEach(function(id, i) {
      setTimeout(function() { var el = $(id); if (el) el.classList.add('on'); }, i*420+150);
    });
    setTimeout(function() { var f = $('bfill'); if (f) f.style.width = '100%'; }, 80);
    setTimeout(function() {
      var bootEl = $('boot');
      var appEl  = $('app');
      if (bootEl) bootEl.classList.add('fade');
      if (appEl)  appEl.classList.remove('hidden');
      setTimeout(function() {
        if (appEl)  appEl.classList.add('show');
        if (bootEl) bootEl.style.display = 'none';
        init();
      }, 800);
    }, 2700);
  }

  /* ── INIT ──────────────────────────────────────────── */
  function init() {
    mapCanvas = $('mini-map');
    if (!mapCanvas) { console.error('mini-map canvas missing'); return; }
    mapCtx = mapCanvas.getContext('2d');

    function sizeMap() {
      var wrap = mapCanvas.parentElement;
      mapW = mapCanvas.width  = wrap.clientWidth;
      mapH = mapCanvas.height = wrap.clientHeight;
      StarField.generate(mapW, mapH, Math.floor(mapW * mapH / 2400));
    }
    sizeMap();
    window.addEventListener('resize', sizeMap);
    StarField.generateMini(160);

    /* Restore saved state */
    try {
      var loc = JSON.parse(localStorage.getItem('sentinel_loc') || 'null');
      if (loc) { myLat = loc.lat; myLon = loc.lon; Renderer.setMyLocation(myLat, myLon); updateLocDisplay(); }
      currentPOV = localStorage.getItem('sentinel_pov') || 'my_location';
    } catch(e) {}

    buildPOVGrid();
    bindUI();
    startClock();
    startMapLoop();

    /* Apply saved mode */
    var savedMode = localStorage.getItem('sentinel_mode') || 'live';
    Tracker.on('update',       onUpdate);
    Tracker.on('status',       onStatus);
    Tracker.on('mode_changed', function(d) { applyModeUI(d.mode); });
    Tracker.setMode(savedMode);
    applyModeUI(savedMode);

    addTelem('Sentinel v5 initialized. Mode: ' + savedMode, 'init');
    addTelem('Pre-warming TLE cache from CelesTrak…', 'new');

    window.addEventListener('beforeinstallprompt', function(e) {
      e.preventDefault(); deferredInstall = e;
      var b = $('btn-install'); if (b) b.style.display = 'block';
    });
  }

  /* ── POV GRID ──────────────────────────────────────── */
  function buildPOVGrid() {
    var grid = $('pov-grid'); if (!grid) return;
    var options = [
      { id:'my_location', name:'My Location', emoji:'📍', norad:'GROUND VIEW', color:'#ffaa00' },
      { id:'global',      name:'Global View', emoji:'🌍', norad:'ALL SATS',    color:'#c084fc' }
    ];
    Object.keys(SATELLITE_CATALOG).forEach(function(id) {
      var cat = SATELLITE_CATALOG[id];
      options.push({ id:id, name:cat.short, emoji:cat.emoji, norad:'NORAD '+id, color:cat.color });
    });

    grid.innerHTML = options.map(function(p) {
      var active = (p.id == currentPOV) ? ' active' : '';
      return '<button class="pov-btn' + active + '" data-pov="' + p.id + '" style="--sat-col:' + p.color + '">' +
        '<div class="pov-active-dot" style="background:' + p.color + '"></div>' +
        '<div class="pov-btn-emoji">' + p.emoji + '</div>' +
        '<div class="pov-btn-name">' + p.name + '</div>' +
        '<div class="pov-btn-norad">' + p.norad + '</div>' +
        '</button>';
    }).join('');

    grid.querySelectorAll('.pov-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        currentPOV = btn.dataset.pov;
        grid.querySelectorAll('.pov-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        Tracker.setPOV(currentPOV);
        localStorage.setItem('sentinel_pov', currentPOV);
        bcast({ type:'pov', pov:currentPOV });
        addTelem('POV: ' + btn.querySelector('.pov-btn-name').textContent, 'new');
      });
    });
  }

  /* ── TRACKER EVENTS ────────────────────────────────── */
  function onUpdate(d) {
    Renderer.setSatellites(d.satellites);
    updateHeroData(d.satellites);
    updatePassCard(d.satellites);
    updateSourcePanel(d);
    if (Tracker.getMode() === 'calculated') {
      updateObsPanel(d.satellites);
      updateTLEPanel();
    }
    var online = 0;
    Object.keys(d.satellites).forEach(function(id) {
      var s = d.satellites[id];
      if (s && !s.offline && s.lat !== undefined) online++;
    });
    addTelem('[' + new Date().toUTCString().slice(17,25) + '] ' + online + '/' +
      Object.keys(SATELLITE_CATALOG).length + ' sats online' +
      (d.mode === 'demo' ? ' [DEMO]' : d.liveCount > 0 ? ' · ' + d.liveCount + ' live' : ''), 'new');
    PassNotifications.checkPasses(d.satellites, myLat, myLon);
    var iss = d.satellites[25544];
    if (iss && iss.lat !== undefined && !iss.offline && window.AudioEngine) {
      AudioEngine.updateState({
        altitude: iss.alt || 408,
        distKm: myLat !== null ? Tracker.haversine(myLat, myLon, iss.lat, iss.lon) : 9999,
        overhead: false
      });
    }
  }

  function onStatus(s) {
    var dot  = $('sig-dot');
    var lbl  = $('sig-label');
    var api  = $('api-dot');
    var mode = $('api-mode-label');
    var map  = {
      live:             { dc:'live',  label:'LIVE',        ac:'ok',  mt:'Live API · multi-source' },
      calculated:       { dc:'calc',  label:'CALCULATED',  ac:'ok',  mt:'SGP4 · CelesTrak TLE' },
      demo:             { dc:'demo',  label:'DEMO',        ac:'err', mt:'Simulation — not real data' },
      acquiring:        { dc:'',      label:'ACQUIRING',   ac:'',    mt:'Connecting…' },
      data_unavailable: { dc:'error', label:'NO DATA',     ac:'err', mt:'All API sources failed' },
      tle_unavailable:  { dc:'error', label:'NO TLE',      ac:'err', mt:'CelesTrak unreachable' }
    };
    var st = map[s] || map.acquiring;
    if (dot)  dot.className  = 'sig-dot ' + st.dc;
    if (lbl)  lbl.textContent = st.label;
    if (api)  api.className  = 'api-status-dot ' + st.ac;
    if (mode) mode.textContent = st.mt;
  }

  function updateHeroData(sats) {
    var focusId = (currentPOV === 'my_location' || currentPOV === 'global') ? 25544 : parseInt(currentPOV, 10);
    var sat = sats[focusId];
    var cat = SATELLITE_CATALOG[focusId];
    if (!sat) return;
    if (sat.offline) { setText('d-lat', 'OFFLINE'); setText('d-lon', '—'); return; }
    setText('d-lat',  fmtCoord(sat.lat, 'N', 'S'));
    setText('d-lon',  fmtCoord(sat.lon, 'E', 'W'));
    setText('d-alt',  sat.alt ? sat.alt.toFixed(1) + ' km' : '—');
    setText('d-vel',  sat.velocity ? (sat.velocity / 1000).toFixed(2) + ' km/s' : '—');
    setText('d-foot', sat.footprint ? Math.round(sat.footprint) + ' km' : '—');
    setText('d-vis',  (sat.visibility || '—').toUpperCase());
    if (cat) {
      var p    = Tracker.getOrbitProgressById(focusId);
      var fill = $('d-orb-fill'); if (fill) fill.style.width = (p * 100) + '%';
      var pct  = $('d-orb-pct');  if (pct)  pct.textContent  = Math.round(p * 100) + '%';
    }
    var tb = $('tle-age-badge');
    if (tb && sat.tleAgeDays != null) {
      tb.textContent = 'TLE: ' + parseFloat(sat.tleAgeDays).toFixed(1) + 'd';
      tb.className   = 'tle-badge ' + (sat.tleAgeDays < 2 ? 'fresh' : sat.tleAgeDays < 7 ? 'good' : sat.tleAgeDays < 14 ? 'aging' : 'expired');
      tb.style.display = 'inline';
    }
    var sb = $('source-badge');
    if (sb) sb.textContent = (sat.source || (sat.demo ? 'demo' : sat.liveData === false ? 'sgp4' : 'api')).toUpperCase().replace('_',' ');
  }

  function updatePassCard(sats) {
    if (myLat === null) return;
    var bestDist = Infinity, bestName = '';
    var focusId  = (currentPOV === 'my_location' || currentPOV === 'global') ? null : parseInt(currentPOV, 10);
    var checkIds = focusId ? [focusId] : Object.keys(sats).map(Number);
    checkIds.forEach(function(id) {
      var sat = sats[id], cat = SATELLITE_CATALOG[id];
      if (!sat || !cat || sat.offline || sat.lat === undefined) return;
      var d = Tracker.haversine(myLat, myLon, sat.lat, sat.lon);
      if (d < bestDist) { bestDist = d; bestName = cat.short; }
    });
    var pEta = $('p-eta'), pSub = $('p-sub'), pDist = $('p-dist');
    if (bestDist < 900) {
      if (pEta) { pEta.textContent = '⚡ NOW'; pEta.style.color = 'var(--iss)'; }
    } else {
      var passes = Tracker.getPassETA();
      var etaMin = 999;
      Object.keys(passes).forEach(function(id) {
        var p = passes[id];
        if (p.etaMin !== null && p.etaMin < etaMin) etaMin = p.etaMin;
      });
      var h = Math.floor(etaMin / 60), m = etaMin % 60;
      if (pEta) { pEta.textContent = etaMin < 999 ? (h > 0 ? h+'h '+m+'m' : '~'+m+' min') : '—'; pEta.style.color = ''; }
    }
    if (pSub)  pSub.textContent  = bestName ? bestName + ' closest' : 'Set location for passes';
    if (pDist) pDist.textContent = bestDist < Infinity ? 'Distance: ' + Math.round(bestDist).toLocaleString() + ' km' : '';
  }

  function updateSourcePanel(d) {
    var panel = $('source-status-panel'); if (!panel) return;
    var statuses = ApiLayer.getSourceStatus();
    var rows = Object.keys(SATELLITE_CATALOG).map(function(id) {
      var cat = SATELLITE_CATALOG[id];
      var sat = d.satellites[id] || {};
      var st  = statuses[id] || {};
      var src = sat.source || (sat.demo ? 'demo' : sat.liveData === false ? 'sgp4' : '—');
      var online = sat && !sat.offline && sat.lat !== undefined;
      var age = sat.tleAgeDays != null ? parseFloat(sat.tleAgeDays).toFixed(1)+'d' : '—';
      var ageCls = sat.tleAgeDays != null ? (sat.tleAgeDays<2?'fresh':sat.tleAgeDays<7?'good':sat.tleAgeDays<14?'aging':'expired') : '';
      return '<div class="src-row">' +
        '<span class="src-dot" style="background:' + (online ? cat.color : 'rgba(80,80,100,0.4)') + '"></span>' +
        '<span class="src-name">' + cat.emoji + ' ' + cat.short + '</span>' +
        '<span class="src-source">' + src.toUpperCase().replace('_',' ') + '</span>' +
        '<span class="src-age ' + ageCls + '">' + age + '</span>' +
        '<span class="src-status ' + (online?'ok':'fail') + '">' + (online?'●LIVE':'○OFF') + '</span>' +
        '</div>';
    });
    panel.innerHTML = rows.join('');
  }

  function updateObsPanel(sats) {
    var grid = $('obs-grid'); if (!grid) return;
    var rows = Object.keys(SATELLITE_CATALOG).map(function(id) {
      var cat = SATELLITE_CATALOG[id];
      var sat = sats[id];
      var obs = (sat && sat.observability) || PassNotifications.getConditions(parseInt(id, 10));
      function pill(ok, lbl) {
        var cls = ok === true ? 'ok' : ok === false ? 'fail' : 'na';
        return '<span class="obs-pill ' + cls + '">' + lbl + '</span>';
      }
      var el = obs && obs.elevation != null ? obs.elevation.toFixed(1) + '°' : '—';
      return '<div class="obs-row">' +
        '<span class="obs-emoji">' + cat.emoji + '</span>' +
        '<span class="obs-sat-name">' + cat.short + '</span>' +
        '<div class="obs-conditions">' +
          pill(obs && obs.aboveHorizon, 'EL>15°') +
          pill(obs && obs.groundDark,   'DARK') +
          pill(obs && obs.illuminated,  'LIT') +
          pill(obs && obs.visible,      obs && obs.visible ? 'VISIBLE' : '—') +
        '</div>' +
        '<span class="obs-angle">' + el + '</span>' +
        '</div>';
    });
    grid.innerHTML = rows.join('');
  }

  function updateTLEPanel() {
    var panel = $('tle-panel'); if (!panel) return;
    var tleStatus = Tracker.getTLEStatus();
    var rows = Object.keys(SATELLITE_CATALOG).map(function(id) {
      var cat = SATELLITE_CATALOG[id];
      var s   = tleStatus[id];
      if (!s) return '<div class="tle-row"><span>' + cat.emoji + ' ' + cat.short + '</span><span class="tle-badge expired">NO TLE</span></div>';
      var cls = s.fresh ? 'fresh' : s.stale ? 'aging' : s.expired ? 'expired' : 'good';
      return '<div class="tle-row"><span>' + cat.emoji + ' ' + cat.short + '</span><span class="tle-badge ' + cls + '">' + (s.ok ? s.ageDays + 'd' : 'EXPIRED') + '</span></div>';
    });
    panel.innerHTML = rows.join('');
  }

  /* ── MAP LOOP ──────────────────────────────────────── */
  function startMapLoop() {
    function loop(now) {
      Renderer.drawMini(mapCtx, mapW, mapH, now - t0);
      flushTelem();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  /* ── CLOCK ─────────────────────────────────────────── */
  function startClock() {
    function tick() {
      var el = $('utc-clock');
      if (el) el.textContent = new Date().toUTCString().slice(17, 25);
    }
    tick(); setInterval(tick, 1000);
  }

  /* ── TELEMETRY ─────────────────────────────────────── */
  function addTelem(msg, type) { telQ.push({ msg: msg, type: type || '' }); }
  function flushTelem() {
    if (!telQ.length || performance.now() - lastTelFlush < 1200) return;
    lastTelFlush = performance.now();
    var s    = $('telem-stream');
    var item = telQ.shift();
    if (!s) return;
    var d = document.createElement('div');
    d.className   = 'tl ' + item.type;
    d.textContent = item.msg;
    s.appendChild(d);
    while (s.children.length > 60) s.removeChild(s.firstChild);
    s.scrollTop = s.scrollHeight;
  }

  /* ── MODE UI ───────────────────────────────────────── */
  function applyModeUI(mode) {
    document.querySelectorAll('.mode-btn').forEach(function(b) {
      b.classList.remove('active-live', 'active-calc', 'active-demo');
      if (b.dataset.mode === mode) {
        b.classList.add(mode === 'live' ? 'active-live' : mode === 'calculated' ? 'active-calc' : 'active-demo');
      }
    });
    var obsPanel  = $('obs-panel');
    var tleHealth = $('tle-health');
    var n2yoPanel = $('n2yo-panel');
    var demoWarn  = $('demo-warning');
    if (obsPanel)  obsPanel.classList.toggle('hidden',  mode !== 'calculated');
    if (tleHealth) tleHealth.classList.toggle('hidden', mode !== 'calculated');
    if (n2yoPanel) n2yoPanel.classList.toggle('hidden', mode === 'demo');
    if (demoWarn)  demoWarn.classList.toggle('hidden',  mode !== 'demo');
  }

  /* ── UI BINDINGS ───────────────────────────────────── */
  function bindUI() {
    /* Location */
    var btnLoc = $('btn-locate');
    if (btnLoc) {
      btnLoc.addEventListener('click', function() {
        if (!navigator.geolocation) { showLocErr('Geolocation not supported.'); return; }
        btnLoc.textContent = '⟳ ACQUIRING…';
        btnLoc.disabled    = true;
        navigator.geolocation.getCurrentPosition(function(pos) {
          myLat = pos.coords.latitude;
          myLon = pos.coords.longitude;
          localStorage.setItem('sentinel_loc', JSON.stringify({ lat:myLat, lon:myLon }));
          Renderer.setMyLocation(myLat, myLon);
          Tracker.setLocation(myLat, myLon);
          updateLocDisplay();
          btnLoc.textContent = '✓ ACQUIRED';
          btnLoc.disabled    = false;
          bcast({ type:'location', lat:myLat, lon:myLon, weatherEnabled: WeatherLayer.isEnabled() });
          if (WeatherLayer.isEnabled()) WeatherLayer.enable(myLat, myLon);
          addTelem('Location: ' + fmtCoord(myLat,'N','S') + ' ' + fmtCoord(myLon,'E','W'), 'new');
        }, function() {
          btnLoc.textContent = '⊕ ACQUIRE LOCATION';
          btnLoc.disabled    = false;
          showLocErr('Permission denied.');
        });
      });
    }

    /* Mode buttons */
    document.querySelectorAll('.mode-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var m = btn.dataset.mode;
        Tracker.setMode(m);
        applyModeUI(m);
        localStorage.setItem('sentinel_mode', m);
        bcast({ type:'mode', mode:m });
        addTelem('Mode switched to: ' + m.toUpperCase(), 'new');
      });
    });

    /* N2YO key */
    var n2yoInput = $('n2yo-key-input');
    if (n2yoInput) {
      n2yoInput.addEventListener('change', function() {
        ApiLayer.setN2YOKey(n2yoInput.value.trim() || null);
        addTelem(n2yoInput.value.trim() ? 'N2YO key set.' : 'N2YO key cleared.', 'new');
      });
    }
    /* N2YO proxy URL */
    var n2yoProxy = $('n2yo-proxy-input');
    if (n2yoProxy) {
      n2yoProxy.addEventListener('change', function() {
        ApiLayer.setN2YOProxy(n2yoProxy.value.trim() || null);
        addTelem(n2yoProxy.value.trim() ? 'N2YO proxy set: ' + n2yoProxy.value.trim() : 'N2YO proxy cleared.', 'new');
      });
    }

    /* Feature toggles */
    var togAudio = $('tog-audio');
    if (togAudio) {
      togAudio.addEventListener('change', function() {
        togAudio.checked ? AudioEngine.enable() : AudioEngine.disable();
        bcast({ type:'audio', enabled:togAudio.checked });
      });
    }
    var togNotify = $('tog-notify');
    if (togNotify) {
      togNotify.addEventListener('change', function() {
        if (togNotify.checked) {
          PassNotifications.enable();
          PassNotifications.requestPermission().then(function(ok) {
            if (!ok) { togNotify.checked = false; showLocErr('Notification permission denied.'); }
          });
        } else {
          PassNotifications.disable();
        }
        bcast({ type:'notify', enabled:togNotify.checked });
      });
    }
    var togWeather = $('tog-weather');
    if (togWeather) {
      togWeather.addEventListener('change', function() {
        togWeather.checked ? WeatherLayer.enable(myLat, myLon) : WeatherLayer.disable();
        bcast({ type:'weather', enabled:togWeather.checked });
      });
    }

    /* View layer checkboxes */
    [['t-stars','stars'],['t-const','constellations'],['t-grid','grid'],['t-term','terminator'],['t-orbit','orbitPath']].forEach(function(pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener('change', function() {
        var o = {}; o[pair[1]] = el.checked;
        Renderer.setOpts(o);
        bcast({ type:'opts', opts:o });
      });
    });

    /* Brightness */
    var slBright = $('sl-bright');
    if (slBright) {
      slBright.addEventListener('input', function() {
        var val = $('sl-bright-val');
        if (val) val.textContent = slBright.value + '%';
        bcast({ type:'brightness', value: slBright.value / 100 });
      });
    }

    /* Ceiling / projection */
    var btnCeiling = $('btn-ceiling');
    if (btnCeiling) {
      btnCeiling.addEventListener('click', function() {
        window.open('view.html', 'sentinel_view');
        setTimeout(function() { bcast({ type:'ceiling', enabled:true }); }, 500);
      });
    }

    /* PWA install */
    var btnInstall = $('btn-install');
    if (btnInstall) {
      btnInstall.addEventListener('click', function() {
        if (deferredInstall) {
          deferredInstall.prompt();
          deferredInstall.userChoice.then(function() {
            deferredInstall = null;
            btnInstall.style.display = 'none';
          });
        }
      });
    }

    /* Map tooltip */
    if (mapCanvas) {
      mapCanvas.addEventListener('mousemove', function(e) {
        var r   = mapCanvas.getBoundingClientRect();
        var mx  = e.clientX - r.left;
        var my_ = e.clientY - r.top;
        var sats = Tracker.getSatellites();
        var found = null, minD = 999;
        Object.keys(sats).forEach(function(id) {
          var sat = sats[id];
          if (!sat || sat.offline || sat.lat === undefined) return;
          var px = ((sat.lon + 180) / 360) * mapW;
          var py = ((90 - sat.lat) / 180) * mapH;
          var d  = Math.sqrt((mx-px)*(mx-px) + (my_-py)*(my_-py));
          if (d < 20 && d < minD) { minD = d; found = { id:parseInt(id,10), sat:sat, px:px, py:py }; }
        });
        var tip = $('map-tip');
        if (tip && found) {
          var cat = SATELLITE_CATALOG[found.id];
          tip.innerHTML = '<b>' + (cat ? cat.name : 'SAT') + '</b><br>' +
            'Lat ' + fmtCoord(found.sat.lat,'N','S') + ' Lon ' + fmtCoord(found.sat.lon,'E','W') + '<br>' +
            'Alt ' + (found.sat.alt ? found.sat.alt.toFixed(0) : '—') + ' km · Src: ' +
            (found.sat.source || 'sgp4').toUpperCase();
          tip.style.left = (found.px + 12) + 'px';
          tip.style.top  = (found.py - 8) + 'px';
          tip.classList.remove('hidden');
        } else if (tip) {
          tip.classList.add('hidden');
        }
      });
      mapCanvas.addEventListener('mouseleave', function() {
        var tip = $('map-tip'); if (tip) tip.classList.add('hidden');
      });
    }
  }

  function updateLocDisplay() {
    var el = $('loc-info'); if (!el) return;
    el.className = 'loc-set';
    el.innerHTML = '<div class="lc-coord">' + fmtCoord(myLat,'N','S') + ', ' + fmtCoord(myLon,'E','W') + '</div>' +
                   '<div class="lc-sub">Browser GPS · stored locally</div>';
    var ps = $('p-sub'); if (ps) ps.textContent = 'Calculating…';
  }

  function showLocErr(msg) {
    var e = $('loc-err'); if (!e) return;
    e.textContent = msg; e.classList.remove('hidden');
    setTimeout(function() { e.classList.add('hidden'); }, 4000);
  }

  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  function fmtCoord(v, p, n) {
    if (v == null) return '—';
    return Math.abs(v).toFixed(3) + '° ' + (v >= 0 ? p : n);
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
