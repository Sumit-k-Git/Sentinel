// weather.js — Cloud cover / weather overlay using Open-Meteo (free, no key)

window.WeatherLayer = (function(){
  let enabled = false;
  let weatherGrid = []; // array of { lat, lon, cloudCover 0-100 }
  let lastFetch = 0;
  const FETCH_INTERVAL = 10 * 60 * 1000; // 10 mins

  // Fetch cloud cover for a grid of points around user location
  async function fetchAround(lat, lon){
    const now = Date.now();
    if(now - lastFetch < FETCH_INTERVAL) return;
    lastFetch = now;

    // Build a coarse grid: 5x5 points ±15 degrees
    const points = [];
    for(let dlat=-12; dlat<=12; dlat+=6){
      for(let dlon=-18; dlon<=18; dlon+=9){
        points.push({ lat: Math.round((lat+dlat)*10)/10, lon: Math.round((lon+dlon)*10)/10 });
      }
    }

    // Open-Meteo supports multiple lat/lon in one call
    const latStr = points.map(p=>p.lat).join(',');
    const lonStr = points.map(p=>p.lon).join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}&current=cloud_cover&forecast_days=1`;

    try{
      const r = await fetch(url);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const data = await r.json();
      // Response is array when multiple locations
      const results = Array.isArray(data) ? data : [data];
      weatherGrid = results.map((d,i)=>({
        lat: points[i].lat,
        lon: points[i].lon,
        cloud: d.current?.cloud_cover ?? 0
      }));
    } catch(e){
      // Fallback: generate plausible noise
      weatherGrid = points.map(p=>({ lat:p.lat, lon:p.lon, cloud:Math.random()*60 }));
    }
  }

  function draw(ctx, W, H, myLat, myLon){
    if(!enabled || !weatherGrid.length) return;
    for(const pt of weatherGrid){
      if(pt.cloud < 10) continue; // skip clear
      const x = ((pt.lon+180)/360)*W;
      const y = ((90-pt.lat)/180)*H;
      const r = W*0.06; // radius of each cloud blob
      const alpha = (pt.cloud/100)*0.22;
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0, `rgba(180,200,240,${alpha})`);
      g.addColorStop(0.5, `rgba(150,170,220,${alpha*0.6})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(Math.max(0,x-r), Math.max(0,y-r), r*2, r*2);
    }
    // Legend
    if(myLat !== null){
      ctx.fillStyle='rgba(180,200,240,0.35)';
      ctx.font=`${Math.max(7,W*0.008)}px Rajdhani,sans-serif`;
      ctx.fillText('☁ CLOUD COVER', 8, H-16);
    }
  }

  function enable(lat, lon){ enabled=true; if(lat!==null) fetchAround(lat,lon); }
  function disable(){ enabled=false; }
  function isEnabled(){ return enabled; }
  function refresh(lat,lon){ if(enabled&&lat!==null) fetchAround(lat,lon); }

  return { enable, disable, isEnabled, draw, refresh };
})();
