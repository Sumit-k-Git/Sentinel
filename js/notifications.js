/**
 * notifications.js — Observability-gated pass notifications
 *
 * Calculated mode: fires ONLY when all three conditions are simultaneously true:
 *   1. Elevation > 15° (satellite high enough above horizon)
 *   2. Observer in nautical twilight or darker (ground is dark)
 *   3. Satellite illuminated by sun (not in Earth's shadow)
 *
 * Live/demo mode: falls back to proximity-based alerting (original behaviour).
 */

window.PassNotifications = (function () {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────
  const ALERT_GAP_MS        = 20 * 60 * 1000;  // min 20 min between alerts per sat
  const PROXIMITY_THRESH_KM = 1200;             // live-mode fallback radius

  // ── State ────────────────────────────────────────────────────────────────
  let enabled = false;
  let granted = false;
  let lastAlerted = {};     // satId → timestamp
  let lastConditions = {};  // satId → last observability snapshot (for UI)

  // ── Permission ───────────────────────────────────────────────────────────
  async function requestPermission() {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') { granted = true; return true; }
    if (Notification.permission === 'denied')  return false;
    const result = await Notification.requestPermission();
    granted = (result === 'granted');
    return granted;
  }

  function enable()     { enabled = true; requestPermission(); }
  function disable()    { enabled = false; }
  function isEnabled()  { return enabled; }

  // ── Main entry point called each tracker tick ────────────────────────────
  /**
   * @param {Object} satellites  — map of id → sat state from Tracker
   * @param {number} myLat
   * @param {number} myLon
   */
  function checkPasses(satellites, myLat, myLon) {
    if (!enabled || !granted || myLat === null) return;

    const mode = Tracker.getMode();
    const now  = new Date();
    const nowMs = now.getTime();

    for (const [idStr, sat] of Object.entries(satellites)) {
      const id  = parseInt(idStr);
      const cat = SATELLITE_CATALOG[id];
      if (!cat || !sat.lat && sat.lat !== 0) continue;

      // ── Cooldown guard ─────────────────────────────────────────────────
      if (lastAlerted[id] && nowMs - lastAlerted[id] < ALERT_GAP_MS) continue;

      if (mode === 'calculated') {
        _checkCalculated(id, cat, sat, now, nowMs);
      } else {
        _checkLive(id, cat, sat, myLat, myLon, nowMs);
      }
    }
  }

  // ── Calculated mode: strict 3-condition pipeline ─────────────────────────
  function _checkCalculated(id, cat, sat, now, nowMs) {
    // Use the pre-computed observability object if tracker already ran it,
    // otherwise ask Tracker to compute it fresh.
    const obs = sat.observability
      || Tracker.computeObservability(id, now);

    if (!obs) return;

    // Store for UI inspection
    lastConditions[id] = {
      elevation:    obs.elevation,
      azimuth:      obs.azimuth,
      aboveHorizon: obs.aboveHorizon,
      groundDark:   obs.groundDark,
      illuminated:  obs.illuminated,
      reason:       obs.reason,
      checkedAt:    nowMs,
    };

    if (!obs.visible) return; // all 3 conditions not met

    // ── FIRE ──────────────────────────────────────────────────────────────
    lastAlerted[id] = nowMs;
    _fireCalculatedNotification(cat, obs);
    if (window.AudioEngine?.isEnabled()) AudioEngine.pingAlert();
  }

  // ── Live/demo mode: proximity-based fallback ─────────────────────────────
  function _checkLive(id, cat, sat, myLat, myLon, nowMs) {
    const dist = Tracker.haversine(myLat, myLon, sat.lat, sat.lon);
    if (dist >= PROXIMITY_THRESH_KM) return;

    lastAlerted[id] = nowMs;
    lastConditions[id] = { proximity: true, distKm: Math.round(dist), checkedAt: nowMs };
    _fireProximityNotification(cat, dist);
    if (window.AudioEngine?.isEnabled()) AudioEngine.pingAlert();
  }

  // ── Notification builders ─────────────────────────────────────────────────
  function _fireCalculatedNotification(cat, obs) {
    if (!granted) return;
    const el  = obs.elevation.toFixed(1);
    const az  = _compassPoint(obs.azimuth);
    const body =
      `Elevation ${el}° · ${az}\n` +
      `Ground: dark ✓ · Satellite: illuminated ✓\n` +
      `Altitude ~${cat.alt} km · Look ${az}`;

    _send(`${cat.emoji} ${cat.name} — VISIBLE NOW`, body, cat.short);
  }

  function _fireProximityNotification(cat, distKm) {
    if (!granted) return;
    const body =
      `${Math.round(distKm)} km from your location.\n` +
      `Altitude ~${cat.alt} km — check the sky!`;
    _send(`${cat.emoji} ${cat.name} — OVERHEAD PASS`, body, cat.short);
  }

  function _send(title, body, tag) {
    try {
      const n = new Notification(title, {
        body,
        icon:   'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="%23000208"/><text y=".9em" font-size="90">🛰</text></svg>',
        badge:  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2300ffe5"/></svg>',
        tag:    'sentinel-' + tag,
        silent: false,
        vibrate: [200, 100, 200],
      });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(() => n.close(), 15000);
    } catch (e) {
      console.warn('[Notifications] Failed to send:', e.message);
    }
  }

  // ── Compass direction label ───────────────────────────────────────────────
  function _compassPoint(azDeg) {
    const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
    return dirs[Math.round(azDeg / 22.5) % 16];
  }

  // ── UI helper: get last known conditions for a sat ───────────────────────
  function getConditions(id) { return lastConditions[id] || null; }
  function getAllConditions() { return { ...lastConditions }; }

  return {
    enable, disable, isEnabled,
    requestPermission,
    checkPasses,
    getConditions,
    getAllConditions,
  };
})();
