// tracker.js — Multi-satellite tracker with POV modes

window.Tracker = (function(){
  const API_BASE = 'https://api.wheretheiss.at/v1/satellites/';
  // Only ISS has a reliable free real-time API; others are simulated from TLE
  const LIVE_IDS = [25544];
  const REFRESH_MS = 5000;

  let satellites = {}; // id -> { lat, lon, alt, velocity, footprint, visibility, trail:[], orbit:[] }
  let listeners = {};
  let timer = null;
  let demoMode = false;
  let demoAngles = {};
  let myLat = null, myLon = null;

  // POV MODES
  const POV_MODES = {
    MY_LOCATION: 'my_location',   // satellites near me / overhead
    ISS:         '25544',
    HUBBLE:      '20580',
    TIANGONG:    '48274',
    NOAA20:      '43205',
    STARLINK:    '44713',
    GLOBAL:      'global',         // show all
  };

  let currentPOV = POV_MODES.MY_LOCATION;
  let activeSatIds = [25544]; // which sats to track

  Object.keys(SATELLITE_CATALOG).forEach(id => { demoAngles[id] = Math.random() * Math.PI * 2; });

  function on(e, fn){ listeners[e] = listeners[e]||[]; listeners[e].push(fn); }
  function emit(e, d){ (listeners[e]||[]).forEach(f=>f(d)); }

  function setPOV(pov){
    currentPOV = pov;
    if(pov === POV_MODES.MY_LOCATION || pov === POV_MODES.GLOBAL){
      activeSatIds = Object.keys(SATELLITE_CATALOG).map(Number);
    } else {
      activeSatIds = [parseInt(pov)];
    }
    emit('pov_changed', { pov, activeSatIds });
  }

  function setLocation(lat, lon){ myLat=lat; myLon=lon; }

  async function fetchSat(id){
    if(demoMode || !LIVE_IDS.includes(id)) return null;
    try{
      const r = await fetch(API_BASE + id);
      if(!r.ok) throw new Error('HTTP '+r.status);
      return await r.json();
    } catch(e){ return null; }
  }

  function simulateSat(id, dt){
    const cat = SATELLITE_CATALOG[id];
    if(!cat) return null;
    demoAngles[id] = (demoAngles[id]||0) + 0.00012 * (dt||1) * (92.68/cat.period);
    const a = demoAngles[id];
    const inc = cat.inc * Math.PI/180;
    const lat = Math.asin(Math.sin(inc)*Math.sin(a)) * 180/Math.PI;
    const lon = (((a*180/Math.PI) + id*37.3) % 360 + 360) % 360 - 180;
    return { latitude:lat, longitude:lon, altitude:cat.alt+(Math.sin(a*3)*3), velocity:cat.alt<600?27600:26400, footprint:cat.alt*10.8, visibility: lat>0?'daylight':'eclipsed' };
  }

  async function tick(){
    const updates = {};
    let anyLive = false;

    for(const id of activeSatIds){
      let data = null;
      if(!demoMode && LIVE_IDS.includes(id)){
        data = await fetchSat(id);
      }
      if(!data){
        data = simulateSat(id);
        if(LIVE_IDS.includes(id) && !anyLive) { /* will set demo */ }
      } else { anyLive = true; }

      if(!data) continue;
      if(!satellites[id]) satellites[id] = { trail:[], orbit:[] };
      const sat = satellites[id];
      Object.assign(sat, { lat:data.latitude, lon:data.longitude, alt:data.altitude, velocity:data.velocity, footprint:data.footprint, visibility:data.visibility });
      sat.trail.push([data.latitude, data.longitude]);
      if(sat.trail.length > 90) sat.trail.shift();
      computeOrbit(id);
      updates[id] = { ...sat, id, catalog: SATELLITE_CATALOG[id] };
    }

    if(!anyLive && !demoMode){ demoMode=true; emit('status','demo'); }
    else if(anyLive && !demoMode){ emit('status','live'); }

    if(Object.keys(updates).length){
      emit('update', { satellites: updates, pov: currentPOV, myLat, myLon });
    }

    // Pass predictions
    if(myLat !== null){
      const passes = computePasses();
      emit('passes', passes);
    }
  }

  function computeOrbit(id){
    const cat = SATELLITE_CATALOG[id];
    const sat = satellites[id];
    if(!cat||!sat) return;
    const orbit = [];
    const lon = sat.lon||0;
    const earthRotPerPeriod = (cat.period/(24*60))*360;
    for(let i=0; i<=cat.period*2; i+=1.5){
      const f = i/cat.period;
      const oLat = cat.inc * Math.sin(f*2*Math.PI);
      const oLon = ((lon + f*360 - f*earthRotPerPeriod*0.5)+540)%360-180;
      orbit.push([oLat,oLon]);
    }
    sat.orbit = orbit;
  }

  function computePasses(){
    const passes = {};
    for(const id of activeSatIds){
      const sat = satellites[id];
      const cat = SATELLITE_CATALOG[id];
      if(!sat||!cat) continue;
      const lon = sat.lon||0, lat = sat.lat||0;
      let minDist=Infinity, minTime=0;
      for(let t=0; t<=cat.period*2; t+=0.5){
        const f = t/cat.period;
        const fLat = cat.inc*Math.sin((demoAngles[id]||0)+f*2*Math.PI)*180/Math.PI;
        const fLon = ((lon+f*360)+540)%360-180;
        const d = haversine(myLat,myLon,fLat,fLon);
        if(d<minDist){ minDist=d; minTime=t; }
      }
      passes[id] = { etaMin:Math.round(minTime), distKm:Math.round(minDist), satName:cat.short };
    }
    return passes;
  }

  function getOrbitProgress(id){
    const cat = SATELLITE_CATALOG[id||25544];
    if(!cat) return 0;
    return ((Date.now()/1000)%(cat.period*60))/(cat.period*60);
  }

  function getNearbyForMyLocation(lat, lon, radiusKm=3000){
    const nearby = [];
    for(const id of Object.keys(SATELLITE_CATALOG).map(Number)){
      const sat = satellites[id];
      if(!sat) continue;
      const dist = haversine(lat,lon,sat.lat,sat.lon);
      if(dist <= radiusKm) nearby.push({id, dist, ...sat, catalog:SATELLITE_CATALOG[id]});
    }
    return nearby.sort((a,b)=>a.dist-b.dist);
  }

  function haversine(a,b,c,d){
    const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180;
    const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2;
    return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
  }

  function start(){ tick(); timer=setInterval(tick,REFRESH_MS); }
  function stop(){ clearInterval(timer); }
  function getSatellites(){ return satellites; }
  function isDemoMode(){ return demoMode; }
  function getPOV(){ return currentPOV; }
  function getPOVModes(){ return POV_MODES; }
  function getPassETA(la,lo){ return computePasses(); }
  function getData(){ return satellites[25544]||{}; }
  function getOrbitProgressById(id){ return getOrbitProgress(id); }
  function getNearby(lat,lon,r){ return getNearbyForMyLocation(lat,lon,r); }

  return { start, stop, on, setPOV, setLocation, getSatellites, isDemoMode, getPOV, getPOVModes, getPassETA, getData, getOrbitProgress, getOrbitProgressById, getNearby, haversine };
})();
