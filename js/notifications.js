/**
 * notifications.js — Observability-gated pass notifications (v5)
 *
 * Calculated mode: fires ONLY when all 3 conditions are simultaneously true:
 *   1. Elevation > 15° (above horizon threshold)
 *   2. Observer in nautical twilight or full darkness (ground dark)
 *   3. Satellite illuminated by sun (not in Earth's shadow)
 *
 * Live mode:     proximity-based alert (<1200 km)
 * Demo mode:     proximity-based alert (clearly labelled DEMO)
 */
window.PassNotifications = (function () {
  'use strict';

  const ALERT_GAP_MS        = 20 * 60 * 1000;
  const PROXIMITY_THRESH_KM = 1200;

  let enabled        = false;
  let granted        = false;
  let lastAlerted    = {};
  let lastConditions = {};

  async function requestPermission() {
    if (!('Notification' in window))              return false;
    if (Notification.permission === 'granted')    { granted = true; return true; }
    if (Notification.permission === 'denied')     return false;
    granted = (await Notification.requestPermission()) === 'granted';
    return granted;
  }

  function enable()    { enabled = true; requestPermission(); }
  function disable()   { enabled = false; }
  function isEnabled() { return enabled; }

  function checkPasses(satellites, myLat, myLon) {
    if (!enabled || !granted || myLat === null) return;
    const mode  = Tracker.getMode();
    const now   = new Date();
    const nowMs = now.getTime();

    for (const [idStr, sat] of Object.entries(satellites)) {
      const id  = parseInt(idStr);
      const cat = SATELLITE_CATALOG[id];
      if (!cat || sat.offline || sat.lat === undefined) continue;
      if (lastAlerted[id] && nowMs - lastAlerted[id] < ALERT_GAP_MS) continue;

      if (mode === 'calculated') {
        _checkCalculated(id, cat, sat, now, nowMs);
      } else {
        _checkProximity(id, cat, sat, myLat, myLon, nowMs, mode);
      }
    }
  }

  function _checkCalculated(id, cat, sat, now, nowMs) {
    const obs = sat.observability || Tracker.computeObservability(id, now);
    if (!obs) return;
    lastConditions[id] = { ...obs, checkedAt: nowMs };
    if (!obs.visible) return;
    lastAlerted[id] = nowMs;
    _fireCalculated(cat, obs);
    if (window.AudioEngine?.isEnabled()) AudioEngine.pingAlert();
  }

  function _checkProximity(id, cat, sat, myLat, myLon, nowMs, mode) {
    const dist = Tracker.haversine(myLat, myLon, sat.lat, sat.lon);
    if (dist >= PROXIMITY_THRESH_KM) return;
    lastAlerted[id] = nowMs;
    lastConditions[id] = { proximity: true, distKm: Math.round(dist), checkedAt: nowMs };
    _fireProximity(cat, dist, mode === 'demo');
    if (window.AudioEngine?.isEnabled()) AudioEngine.pingAlert();
  }

  function _fireCalculated(cat, obs) {
    if (!granted) return;
    _send(
      `${cat.emoji} ${cat.name} — VISIBLE NOW`,
      `Elevation ${obs.elevation.toFixed(1)}° · ${_compassPoint(obs.azimuth)}\n` +
      `Ground: dark ✓  Satellite: illuminated ✓\n` +
      `Altitude ~${cat.alt} km`,
      cat.short
    );
  }

  function _fireProximity(cat, distKm, isDemo) {
    if (!granted) return;
    const prefix = isDemo ? '[DEMO] ' : '';
    _send(
      `${prefix}${cat.emoji} ${cat.name} — OVERHEAD PASS`,
      `${Math.round(distKm)} km from your location.\nAltitude ~${cat.alt} km — look up!`,
      cat.short
    );
  }

  function _send(title, body, tag) {
    try {
      const n = new Notification(title, {
        body, tag: 'sentinel-' + tag, silent: false, vibrate: [200, 100, 200],
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23000208"/><text y=".9em" font-size="90">🛰</text></svg>',
      });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 15000);
    } catch(e) { console.warn('[Notifications]', e.message); }
  }

  function _compassPoint(az) {
    const d = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return d[Math.round(az / 22.5) % 16];
  }

  function getConditions(id)  { return lastConditions[id] || null; }
  function getAllConditions()  { return { ...lastConditions }; }

  return { enable, disable, isEnabled, requestPermission, checkPasses, getConditions, getAllConditions };
})();
