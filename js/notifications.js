// notifications.js — Pass notifications via browser Push/Notification API

window.PassNotifications = (function(){
  let enabled = false;
  let granted = false;
  let lastAlerted = {}; // satId -> timestamp
  const ALERT_GAP_MS = 30 * 60 * 1000; // don't re-alert same sat within 30 min
  const PASS_THRESHOLD_KM = 1200; // notify when within ~1200km footprint

  async function requestPermission(){
    if(!('Notification' in window)) return false;
    if(Notification.permission === 'granted'){ granted=true; return true; }
    if(Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    granted = result === 'granted';
    return granted;
  }

  function enable(){ enabled=true; requestPermission(); }
  function disable(){ enabled=false; }
  function isEnabled(){ return enabled; }

    function checkPasses(satellites, myLat, myLon){
    if(!enabled || !granted || myLat===null) return;
    const now = Date.now();
    
    for(const [idStr, sat] of Object.entries(satellites)){
      const id = parseInt(idStr);
      const cat = SATELLITE_CATALOG[id];
      if(!cat || !sat.lat) continue;

      // THE MAGIC: Only trigger if the satellite is optically visible!
      if(sat.visibility === 'visible' && sat.elevation > 15){
        
        // Don't spam the user if we already alerted them for this pass
        if(!lastAlerted[id] || now - lastAlerted[id] > ALERT_GAP_MS){
          lastAlerted[id] = now;
          fireNotification(cat, sat.elevation, sat.alt);
          if(AudioEngine.isEnabled()) AudioEngine.pingAlert();
        }
      }
    }
  }

  function fireNotification(cat, elevation, altitude){
    if(!granted) return;
    try{
      const n = new Notification(`⭐ ${cat.emoji} ${cat.name} VISIBLE NOW`, {
        body: `Look up! It is currently ${Math.round(elevation)}° above the horizon.\nAltitude: ~${Math.round(altitude)} km`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🛰</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2300ffe5"/></svg>',
        tag: 'sentinel-pass-'+cat.short,
        silent: false,
      });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(()=>n.close(), 12000);
    }catch(e){ console.warn('Notification failed:', e); }
  }


  function fireNotification(cat, distKm){
    if(!granted) return;
    try{
      const n = new Notification(`${cat.emoji} ${cat.name} — OVERHEAD PASS`, {
        body: `Now ${Math.round(distKm)} km away from your location. Look up!\nAltitude: ~${cat.alt} km`,
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🛰</text></svg>',
        badge: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="%2300ffe5"/></svg>',
        tag: 'sentinel-pass-'+cat.short,
        silent: false,
      });
      n.onclick = () => { window.focus(); n.close(); };
      setTimeout(()=>n.close(), 12000);
    }catch(e){ console.warn('Notification failed:', e); }
  }

  return { enable, disable, isEnabled, requestPermission, checkPasses };
})();
