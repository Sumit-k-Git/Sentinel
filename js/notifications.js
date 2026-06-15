window.PassNotifications = (function () {
  var ALERT_GAP = 20 * 60 * 1000;
  var PROX_KM   = 1200;
  var enabled   = false;
  var granted   = false;
  var lastAlert = {};
  var lastConds = {};

  function requestPermission() {
    if (!('Notification' in window)) return Promise.resolve(false);
    if (Notification.permission === 'granted') { granted = true; return Promise.resolve(true); }
    if (Notification.permission === 'denied')  return Promise.resolve(false);
    return Notification.requestPermission().then(function(r) {
      granted = r === 'granted'; return granted;
    });
  }

  function enable()    { enabled = true; requestPermission(); }
  function disable()   { enabled = false; }
  function isEnabled() { return enabled; }

  function checkPasses(sats, myLat, myLon) {
    if (!enabled || !granted || myLat === null) return;
    var mode  = Tracker.getMode();
    var now   = new Date();
    var nowMs = now.getTime();
    Object.keys(sats).forEach(function(idStr) {
      var id  = parseInt(idStr);
      var sat = sats[id];
      var cat = SATELLITE_CATALOG[id];
      if (!cat || !sat || sat.offline || sat.lat === undefined) return;
      if (lastAlert[id] && nowMs - lastAlert[id] < ALERT_GAP) return;
      if (mode === 'calculated') {
        var obs = sat.observability || Tracker.computeObservability(id, now);
        if (!obs) return;
        lastConds[id] = Object.assign({}, obs, { checkedAt: nowMs });
        if (!obs.visible) return;
        lastAlert[id] = nowMs;
        send(cat.emoji + ' ' + cat.name + ' — VISIBLE NOW',
          'El ' + obs.elevation.toFixed(1) + '° · Ground dark ✓ · Illuminated ✓\nAlt ~' + cat.alt + ' km', cat.short);
        if (window.AudioEngine && AudioEngine.isEnabled()) AudioEngine.pingAlert();
      } else {
        var dist = Tracker.haversine(myLat, myLon, sat.lat, sat.lon);
        if (dist >= PROX_KM) return;
        lastAlert[id] = nowMs;
        lastConds[id] = { proximity: true, distKm: Math.round(dist), checkedAt: nowMs };
        send((mode==='demo'?'[DEMO] ':'')+cat.emoji+' '+cat.name+' — OVERHEAD',
          Math.round(dist)+' km away · Alt ~'+cat.alt+' km', cat.short);
        if (window.AudioEngine && AudioEngine.isEnabled()) AudioEngine.pingAlert();
      }
    });
  }

  function send(title, body, tag) {
    try {
      var n = new Notification(title, { body: body, tag: 'sentinel-'+tag, vibrate: [200,100,200] });
      n.onclick = function() { window.focus(); n.close(); };
      setTimeout(function() { n.close(); }, 12000);
    } catch(e) { console.warn('[Notify]', e.message); }
  }

  function getConditions(id)  { return lastConds[id] || null; }
  function getAllConditions()  { return Object.assign({}, lastConds); }

  return { enable: enable, disable: disable, isEnabled: isEnabled,
           requestPermission: requestPermission, checkPasses: checkPasses,
           getConditions: getConditions, getAllConditions: getAllConditions };
})();
