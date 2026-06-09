// tracker.js — ISS data fetching and orbital math

window.Tracker = (function () {
  const API_URL = 'https://api.wheretheiss.at/v1/satellites/25544';
  const REFRESH_MS = 5000;

  let issData = {
    latitude: 0, longitude: 0,
    altitude: 408, velocity: 27600,
    footprint: 4500, visibility: 'daylight',
    timestamp: 0,
  };
  let trail = [];
  let orbit = [];
  let listeners = {};
  let timer = null;
  let useDemoMode = false;
  let demoAngle = 0;

  function on(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
  }

  function emit(event, data) {
    (listeners[event] || []).forEach(fn => fn(data));
  }

  async function fetch_iss() {
    if (useDemoMode) {
      simulateOrbit();
      return;
    }
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      issData = d;

      trail.push([d.latitude, d.longitude]);
      if (trail.length > 80) trail.shift();

      computeOrbit(d.latitude, d.longitude);
      emit('update', { ...issData, trail, orbit });
      emit('status', 'live');
    } catch (e) {
      console.warn('ISS API unavailable, switching to demo mode:', e.message);
      useDemoMode = true;
      emit('status', 'demo');
      simulateOrbit();
    }
  }

  function simulateOrbit() {
    // Simulate ISS moving along its orbital track
    demoAngle += 0.0012;
    const inc = 51.64 * Math.PI / 180;
    const lat = Math.asin(Math.sin(inc) * Math.sin(demoAngle)) * 180 / Math.PI;
    const lon = (((demoAngle * 180 / Math.PI) % 360) + 360) % 360 - 180;
    issData = {
      latitude: lat, longitude: lon,
      altitude: 408 + Math.sin(demoAngle * 3) * 2,
      velocity: 7.66 + Math.random() * 0.01,
      footprint: 4500, visibility: lat > 0 ? 'daylight' : 'eclipsed',
      timestamp: Date.now() / 1000,
    };
    trail.push([lat, lon]);
    if (trail.length > 80) trail.shift();
    computeOrbit(lat, lon);
    emit('update', { ...issData, trail, orbit });
  }

  function computeOrbit(lat, lon) {
    orbit = [];
    const inc = 51.64;
    const period = 92.68; // minutes
    const earthRotPerPeriod = (period / (24 * 60)) * 360;

    for (let i = 0; i <= period * 2; i += 1.5) {
      const frac = i / period;
      const oLat = inc * Math.sin(frac * 2 * Math.PI);
      const oLon = ((lon + frac * 360 - frac * earthRotPerPeriod * 0.5) + 540) % 360 - 180;
      orbit.push([oLat, oLon]);
    }
  }

  function getOrbitProgress() {
    // Return 0-1 fraction of current orbit based on time
    const now = Date.now() / 1000;
    const periodSec = 92.68 * 60;
    return (now % periodSec) / periodSec;
  }

  function getPassETA(myLat, myLon) {
    if (myLat === null || !orbit.length) return null;
    let minDist = Infinity;
    let minTime = 0;
    const inc = 51.64;
    const period = 92.68;
    const lon = issData.longitude;

    // Sample future positions over next 2 orbits
    for (let t = 0; t <= period * 2; t += 0.5) {
      const frac = t / period;
      const futureLat = inc * Math.sin((demoAngle + frac * 2 * Math.PI));
      const futureLon = ((lon + frac * 360) + 540) % 360 - 180;
      const dist = haversine(myLat, myLon, futureLat, futureLon);
      if (dist < minDist) {
        minDist = dist;
        minTime = t;
      }
    }
    return { etaMin: Math.round(minTime), distKm: Math.round(minDist) };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function start() {
    fetch_iss();
    timer = setInterval(fetch_iss, REFRESH_MS);
  }

  function stop() {
    if (timer) clearInterval(timer);
  }

  function getData() { return issData; }
  function getTrail() { return trail; }
  function getOrbit() { return orbit; }
  function isDemoMode() { return useDemoMode; }

  return { start, stop, on, getData, getTrail, getOrbit, getPassETA, getOrbitProgress, isDemoMode };
})();
