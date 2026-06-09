// app.js — Main application orchestrator

(function () {
  'use strict';

  // ── State ──────────────────────────────────────
  let myLat = null, myLon = null;
  let animFrame = null;
  let startTime = null;
  let telemetryQueue = [];
  let lastTelemetryFlush = 0;
  let brightness = 80;

  // ── DOM refs ───────────────────────────────────
  const $ = id => document.getElementById(id);
  const boot = $('boot-screen');
  const app = $('app');
  const canvas = $('sky-canvas');
  const miniCanvas = $('mini-sky');
  const tooltip = $('map-tooltip');

  // ── Boot sequence ──────────────────────────────
  function boot_sequence() {
    const lines = ['boot-line-1','boot-line-2','boot-line-3','boot-line-4'];
    const fill = $('boot-fill');

    lines.forEach((id, i) => {
      setTimeout(() => {
        $(id).classList.add('visible');
      }, i * 420 + 200);
    });

    setTimeout(() => {
      fill.style.width = '100%';
    }, 100);

    setTimeout(() => {
      boot.classList.add('fade-out');
      app.classList.remove('hidden');
      setTimeout(() => {
        app.classList.add('visible');
        boot.style.display = 'none';
        startApp();
      }, 800);
    }, 2800);
  }

  // ── Start app ──────────────────────────────────
  function startApp() {
    Renderer.init(canvas);
    StarField.generateMini(180);

    bindUI();
    startClock();
    startAnimation();
    Tracker.start();

    Tracker.on('update', onISSUpdate);
    Tracker.on('status', onStatus);

    addTelemetry('System initialized.', 'init');
    addTelemetry('Connecting to wheretheiss.at API...', 'new');
    addTelemetry('ISS NORAD ID: 25544', 'new');

    window.addEventListener('resize', () => {
      Renderer.resize();
      StarField.generate(canvas.clientWidth, canvas.clientHeight);
    });
  }

  // ── ISS Data update ────────────────────────────
  function onISSUpdate(data) {
    Renderer.setISS(data.latitude, data.longitude);
    Renderer.setTrail(data.trail);
    Renderer.setOrbit(data.orbit);

    // Panel values
    $('iss-lat').textContent = fmt(data.latitude, 4) + '°';
    $('iss-lon').textContent = fmt(data.longitude, 4) + '°';
    $('iss-alt').textContent = fmt(data.altitude, 1) + ' km';
    $('iss-vel').textContent = (data.velocity / 1000).toFixed(2) + ' km/s';
    $('iss-foot').textContent = Math.round(data.footprint) + ' km';
    $('iss-vis').textContent = (data.visibility || 'unknown').toUpperCase();

    // Orbit progress bar
    const prog = Tracker.getOrbitProgress();
    $('orbit-fill').style.width = (prog * 100) + '%';
    $('orbit-pct').textContent = Math.round(prog * 100) + '% complete';

    // Pass ETA
    if (myLat !== null) {
      const pass = Tracker.getPassETA(myLat, myLon);
      if (pass) {
        if (pass.distKm < 1000) {
          $('pass-eta').textContent = '⚡ OVERHEAD';
          $('pass-eta').style.color = 'var(--accent-green)';
        } else {
          const h = Math.floor(pass.etaMin / 60);
          const m = pass.etaMin % 60;
          $('pass-eta').textContent = h > 0 ? `${h}h ${m}m` : `~${m} min`;
          $('pass-eta').style.color = '';
        }
        $('pass-dist').textContent = 'Distance: ' + pass.distKm.toLocaleString() + ' km';
        $('pass-sub').textContent = 'Estimated next closest approach';
      }
    }

    // Telemetry log (throttled)
    telemetryQueue.push({
      msg: `[${new Date().toUTCString().slice(17,25)}] ISS ${fmt(data.latitude,2)}° ${fmt(data.longitude,2)}° | ${fmt(data.altitude,0)} km`,
      type: 'new'
    });
  }

  function onStatus(s) {
    const dot = $('signal-dot');
    const lbl = $('signal-label');
    const apiDot = $('api-dot');
    if (s === 'live') {
      dot.className = 'signal-dot live';
      lbl.textContent = 'LIVE';
      apiDot.className = 'api-dot ok';
      addTelemetry('Live data stream established.', 'new');
    } else {
      dot.className = 'signal-dot error';
      lbl.textContent = 'DEMO';
      apiDot.className = 'api-dot err';
      addTelemetry('API unavailable — demo orbit mode active.', 'warn');
    }
  }

  // ── Clock ──────────────────────────────────────
  function startClock() {
    function tick() {
      const now = new Date();
      const h = pad(now.getUTCHours());
      const m = pad(now.getUTCMinutes());
      const s = pad(now.getUTCSeconds());
      $('utc-clock').textContent = `${h}:${m}:${s} UTC`;
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── Animation loop ─────────────────────────────
  function startAnimation() {
    startTime = performance.now();
    function loop(now) {
      const t = now - startTime;
      Renderer.draw(t);
      drawMiniSky(t);
      flushTelemetry();
      animFrame = requestAnimationFrame(loop);
    }
    animFrame = requestAnimationFrame(loop);
  }

  function drawMiniSky(t) {
    StarField.drawMini(miniCanvas.getContext('2d'), 180, myLat, myLon, t);
    $('mini-sky-label').textContent = myLat !== null
      ? `Zenith @ ${fmt(myLat, 1)}°, ${fmt(myLon, 1)}°`
      : 'Set location for sky view';
  }

  // ── Telemetry stream ───────────────────────────
  function addTelemetry(msg, type) {
    telemetryQueue.push({ msg, type: type || '' });
  }

  function flushTelemetry() {
    const now = performance.now();
    if (telemetryQueue.length === 0 || now - lastTelemetryFlush < 1200) return;
    lastTelemetryFlush = now;

    const stream = $('telemetry-stream');
    const item = telemetryQueue.shift();
    const div = document.createElement('div');
    div.className = 'telem-line ' + item.type;
    div.textContent = item.msg;
    stream.appendChild(div);
    // Keep max 40 lines
    while (stream.children.length > 40) stream.removeChild(stream.firstChild);
    stream.scrollTop = stream.scrollHeight;
  }

  // ── UI bindings ────────────────────────────────
  function bindUI() {
    // Geolocation
    $('btn-locate').addEventListener('click', () => {
      if (!navigator.geolocation) {
        showLocError('Geolocation not supported by this browser.');
        return;
      }
      $('btn-locate').textContent = '⟳ LOCATING...';
      $('btn-locate').disabled = true;
      navigator.geolocation.getCurrentPosition(
        pos => {
          myLat = pos.coords.latitude;
          myLon = pos.coords.longitude;
          Renderer.setMyLocation(myLat, myLon);
          updateLocDisplay();
          $('btn-locate').textContent = '✓ LOCATION SET';
          $('btn-locate').disabled = false;
          $('pass-sub').textContent = 'Calculating...';
          addTelemetry(`User location acquired: ${fmt(myLat,2)}°, ${fmt(myLon,2)}°`, 'new');
        },
        err => {
          $('btn-locate').textContent = '⊕ SET MY LOCATION';
          $('btn-locate').disabled = false;
          showLocError('Permission denied or unavailable.');
          addTelemetry('Location permission denied.', 'warn');
        }
      );
    });

    // Toggle checkboxes
    $('tog-stars').addEventListener('change', e => Renderer.setOpts({ stars: e.target.checked }));
    $('tog-constellations').addEventListener('change', e => Renderer.setOpts({ constellations: e.target.checked }));
    $('tog-grid').addEventListener('change', e => Renderer.setOpts({ grid: e.target.checked }));
    $('tog-terminator').addEventListener('change', e => Renderer.setOpts({ terminator: e.target.checked }));
    $('tog-orbit').addEventListener('change', e => Renderer.setOpts({ orbitPath: e.target.checked }));

    // Ceiling mode toggle
    $('btn-ceiling').addEventListener('click', toggleCeilingMode);
    $('tog-ambient').addEventListener('change', e => {
      if (e.target.checked) enableCeilingMode();
      else disableCeilingMode();
    });
    $('ceiling-overlay').addEventListener('click', disableCeilingMode);

    // Fullscreen
    $('btn-fullscreen').addEventListener('click', toggleFullscreen);

    // Brightness
    $('brightness').addEventListener('input', e => {
      brightness = parseInt(e.target.value);
      $('brightness-val').textContent = brightness + '%';
      app.style.filter = `brightness(${brightness / 100})`;
    });

    // Canvas tooltip
    canvas.addEventListener('mousemove', onCanvasHover);
    canvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      if (e.key === 'c' || e.key === 'C') toggleCeilingMode();
      if (e.key === 'Escape') disableCeilingMode();
    });

    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) {
        $('btn-fullscreen').textContent = '⛶ FULLSCREEN';
      }
    });
  }

  function onCanvasHover(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const pos = Renderer.getISSScreenPos();
    const dx = mx - pos.x, dy = my - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 24) {
      const d = Tracker.getData();
      tooltip.innerHTML =
        `<b>ISS — International Space Station</b><br>` +
        `Lat: ${fmt(d.latitude, 4)}° &nbsp; Lon: ${fmt(d.longitude, 4)}°<br>` +
        `Alt: ${fmt(d.altitude, 1)} km &nbsp; Vel: ${(d.velocity / 1000).toFixed(2)} km/s<br>` +
        `Visibility: ${(d.visibility || 'unknown').toUpperCase()} &nbsp; Footprint: ${Math.round(d.footprint)} km`;
      tooltip.style.left = (pos.x + 18) + 'px';
      tooltip.style.top = (pos.y - 8) + 'px';
      tooltip.classList.remove('hidden');
    } else {
      tooltip.classList.add('hidden');
    }
  }

  function updateLocDisplay() {
    const el = $('loc-display');
    el.innerHTML =
      `<div class="loc-set">` +
      `<div class="loc-coord">${fmt(myLat, 4)}° N, ${fmt(myLon, 4)}° E</div>` +
      `<div class="loc-name">Location acquired via browser GPS</div>` +
      `</div>`;
  }

  function showLocError(msg) {
    const el = $('loc-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ── Ceiling / Projection Mode ──────────────────
  function toggleCeilingMode() {
    if (app.classList.contains('ceiling-mode')) disableCeilingMode();
    else enableCeilingMode();
  }
  function enableCeilingMode() {
    app.classList.add('ceiling-mode');
    $('ceiling-overlay').classList.remove('hidden');
    $('tog-ambient').checked = true;
    addTelemetry('Ceiling projection mode enabled.', 'new');
    // Auto-fullscreen
    if (!document.fullscreenElement) {
      app.requestFullscreen && app.requestFullscreen();
    }
  }
  function disableCeilingMode() {
    app.classList.remove('ceiling-mode');
    $('ceiling-overlay').classList.add('hidden');
    $('tog-ambient').checked = false;
    if (document.fullscreenElement) document.exitFullscreen();
  }

  // ── Fullscreen ─────────────────────────────────
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      app.requestFullscreen && app.requestFullscreen();
      $('btn-fullscreen').textContent = '⛶ EXIT FULLSCREEN';
    } else {
      document.exitFullscreen();
      $('btn-fullscreen').textContent = '⛶ FULLSCREEN';
    }
  }

  // ── Helpers ────────────────────────────────────
  function fmt(val, dec) {
    if (val === undefined || val === null) return '—';
    return parseFloat(val).toFixed(dec);
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // ── Init ───────────────────────────────────────
  document.addEventListener('DOMContentLoaded', boot_sequence);

})();
