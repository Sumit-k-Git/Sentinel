// tracker.js — Live TLE propagation and visibility engine

window.Tracker = (function(){
  const events = { update: [], status: [] };
  let satrecs = {};
  let myLat = null, myLon = null;
  let currentPOV = 'my_location';
  let running = false;
  
  // The NORAD IDs matching your view.html catalog
  const TARGET_IDS = [25544, 20580, 43205, 25338, 28654, 27424, 39084, 44713, 44914];
  const CELESTRAK_URL = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${TARGET_IDS.join(',')}&FORMAT=tle`;

  // ── Event Emitter ─────────────────────────────────────
  function on(name, cb) { events[name].push(cb); }
  function emit(name, data) { events[name].forEach(cb => cb(data)); }

  // ── Initialization & Fetch ────────────────────────────
  async function start() {
    if(running) return;
    running = true;
    emit('status', 'connecting');
    
    try {
      const res = await fetch(CELESTRAK_URL);
      if(!res.ok) throw new Error("CelesTrak fetch failed");
      const text = await res.text();
      parseTLEs(text);
      emit('status', 'live');
      runEngine();
    } catch(err) {
      console.error("Tracker API Error:", err);
      emit('status', 'demo'); // You can implement a local TLE fallback here if needed
    }
  }

  function parseTLEs(tleText) {
    const lines = tleText.trim().split('\n');
    satrecs = {};
    // CelesTrak TLE format returns 3 lines per object: Name, Line1, Line2
    for(let i = 0; i < lines.length; i += 3) {
      const name = lines[i].trim();
      const line1 = lines[i+1].trim();
      const line2 = lines[i+2].trim();
      
      const noradId = parseInt(line1.substring(2, 7), 10);
      satrecs[noradId] = satellite.twoline2satrec(line1, line2);
    }
  }

  // ── Main Engine Loop ──────────────────────────────────
  function runEngine() {
    setInterval(() => {
      const now = new Date();
      const gmst = satellite.gstime(now);
      let outData = { satellites: {} };

      for(const [id, satrec] of Object.entries(satrecs)) {
        // 1. Calculate physical position in space
        const posVel = satellite.propagate(satrec, now);
        if(!posVel.position) continue;
        
        // 2. Convert to map coordinates
        const geo = satellite.eciToGeodetic(posVel.position, gmst);
        const lat = satellite.degreesLat(geo.latitude);
        const lon = satellite.degreesLong(geo.longitude);
        const alt = geo.height;
        const vel = Math.sqrt(
          Math.pow(posVel.velocity.x, 2) + 
          Math.pow(posVel.velocity.y, 2) + 
          Math.pow(posVel.velocity.z, 2)
        );

        // 3. Calculate visibility (Look angles & Eclipse)
        let visibilityStatus = 'daylight';
        let elevation = 0;

        if (myLat !== null && myLon !== null) {
          const observerGd = {
            longitude: satellite.degreesToRadians(myLon),
            latitude: satellite.degreesToRadians(myLat),
            height: 0.1 // 100 meters roughly
          };
          
          const positionEcf = satellite.eciToEcf(posVel.position, gmst);
          const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
          elevation = satellite.degreesLat(lookAngles.elevation);
          
          // SunCalc Darkness Check
          const sunPos = SunCalc.getPosition(now, myLat, myLon);
          const sunAltDegrees = sunPos.altitude * (180 / Math.PI);
          
          if(sunAltDegrees < -6) { // Nautical twilight or darker
             const isEclipsed = checkEclipse(posVel.position, now);
             if (isEclipsed) {
                 visibilityStatus = 'eclipsed';
             } else if (elevation > 15) {
                 visibilityStatus = 'visible';
             } else {
                 visibilityStatus = 'horizon';
             }
          }
        }

        // 4. Generate Orbit Paths & Trails (Simplified for UI)
        // In a full build, you'd propagate ±45 minutes into an array here
        const orbit = generateOrbitPath(satrec, now);

        outData.satellites[id] = {
          lat, lon, alt, 
          velocity: vel * 1000, // Convert to meters/sec for UI compatibility
          footprint: 12756.2 * Math.acos(6371 / (6371 + alt)), // Rough footprint math
          visibility: visibilityStatus,
          elevation: elevation,
          orbit: orbit,
          trail: orbit.slice(0, 10) // Mocking a short trail for the renderer
        };
      }
      
      emit('update', outData);
    }, 1000); // 1-second ticks are smooth enough for a global map
  }

  // ── Math Helpers ──────────────────────────────────────
  
  function checkEclipse(satPosEci, date) {
    // Basic cylindrical shadow model for Earth eclipse
    const sr = 6371.0; // Earth radius
    const sunPos = getSunPositionEci(date); 
    
    // Dot product to check angle
    const dot = satPosEci.x * sunPos.x + satPosEci.y * sunPos.y + satPosEci.z * sunPos.z;
    if (dot > 0) return false; // Satellite is sunward

    // Calculate perpendicular distance to the Earth-Sun line
    const satDist = Math.sqrt(satPosEci.x**2 + satPosEci.y**2 + satPosEci.z**2);
    const angle = Math.acos(dot / (satDist * 1)); // normalized sun vector
    const perpDist = satDist * Math.sin(angle);
    
    return perpDist < sr;
  }

  function getSunPositionEci(date) {
    // Highly simplified Sun ECI vector for eclipse calculation
    const d = (date.getTime() / 86400000) - 10957.5;  
    const L = (280.460 + 0.9856474 * d) * (Math.PI / 180);
    return { x: Math.cos(L), y: Math.sin(L) * Math.cos(0.409), z: Math.sin(L) * Math.sin(0.409) };
  }

  function generateOrbitPath(satrec, now) {
    const path = [];
    // Propagate forward 90 minutes to draw the track
    for(let i = 0; i < 90; i += 3) {
      const future = new Date(now.getTime() + (i * 60000));
      const p = satellite.propagate(satrec, future);
      if(p.position) {
         const g = satellite.eciToGeodetic(p.position, satellite.gstime(future));
         path.push([satellite.degreesLat(g.latitude), satellite.degreesLong(g.longitude)]);
      }
    }
    return path;
  }

  function setLocation(lat, lon) { myLat = lat; myLon = lon; }
  function setPOV(pov) { currentPOV = pov; }
  
  // ── Heavy Orbital Math ──────────────────────────────────────

  // 1. Orbit Progress Calculator
  function getOrbitProgressById(id) {
    const satrec = satrecs[id];
    if(!satrec) return 0;
    
    // Get current time in Julian Date
    const now = new Date();
    const currentJd = (now.getTime() / 86400000.0) + 2440587.5;
    
    // Delta t (minutes since the TLE epoch)
    const timeSinceEpochMins = (currentJd - satrec.jdsatepoch) * 1440.0;
    
    // M = (M0 + n * dt) % 2PI
    let currentMeanAnomaly = (satrec.mo + satrec.no * timeSinceEpochMins) % (2 * Math.PI);
    if (currentMeanAnomaly < 0) currentMeanAnomaly += 2 * Math.PI;
    
    // Return fraction of completion (0.0 to 1.0)
    return currentMeanAnomaly / (2 * Math.PI);
  }

  // 2. Pass Prediction Engine
  let cachedPasses = {};
  let lastPassCalc = 0;

  function getPassETA(lat, lon) {
    const now = Date.now();
    
    // Throttle: Only recalculate heavy physics every 60 seconds
    if (now - lastPassCalc < 60000 && Object.keys(cachedPasses).length > 0) {
      const elapsedMins = (now - lastPassCalc) / 60000;
      const updatedCache = {};
      for(const [id, pass] of Object.entries(cachedPasses)) {
         updatedCache[id] = { 
           ...pass, 
           etaMin: pass.etaMin === 999 ? 999 : Math.max(0, pass.etaMin - elapsedMins) 
         };
      }
      return updatedCache;
    }

    lastPassCalc = now;
    cachedPasses = {};
    
    const observerGd = {
      longitude: satellite.degreesToRadians(lon),
      latitude: satellite.degreesToRadians(lat),
      height: 0.1 // Assume observer is roughly 100m above sea level
    };

    // Propagate forward to find the next overhead pass
    for(const [id, satrec] of Object.entries(satrecs)) {
       let foundPass = false;
       
       // Search up to 300 minutes (~3 orbits) into the future, checking every 2 minutes
       for(let tOffset = 0; tOffset <= 300; tOffset += 2) {
         const futureTime = new Date(now + tOffset * 60000);
         const posVel = satellite.propagate(satrec, futureTime);
         if(!posVel.position) continue;
         
         const gmst = satellite.gstime(futureTime);
         const positionEcf = satellite.eciToEcf(posVel.position, gmst);
         const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
         
         const elevation = satellite.degreesLat(lookAngles.elevation);
         
         // Trigger criteria: If the satellite rises above 10 degrees
         if(elevation > 10) {
           const geo = satellite.eciToGeodetic(posVel.position, gmst);
           const satLat = satellite.degreesLat(geo.latitude);
           const satLon = satellite.degreesLong(geo.longitude);
           const dist = haversine(lat, lon, satLat, satLon);
           
           cachedPasses[id] = { etaMin: tOffset, distKm: dist };
           foundPass = true;
           break; 
         }
       }
       // If no pass found in the 300 min window, output default null values
       if(!foundPass) cachedPasses[id] = { etaMin: 999, distKm: 9999 };
    }
    return cachedPasses;
  }


  // Haversine formula
  function haversine(a,b,c,d) { 
      const R=6371, dL=(c-a)*Math.PI/180, dG=(d-b)*Math.PI/180; 
      const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; 
      return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); 
  }

  return { start, on, setLocation, setPOV, getOrbitProgressById, getPassETA, getSatellites, haversine };
})();
