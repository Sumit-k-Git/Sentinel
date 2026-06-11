/**
 * renderer.js — Mini-map renderer (v5)
 * Draws all satellites with trails, handles offline/demo states visually.
 */
window.Renderer = (function () {
  'use strict';

  let _sats = {}, _myLat = null, _myLon = null;
  const opts = { stars:true, constellations:true, grid:true, terminator:true, orbitPath:true };

  function setOpts(o)          { Object.assign(opts, o); }
  function setSatellites(s)    { _sats = s; }
  function setMyLocation(a, b) { _myLat = a; _myLon = b; }

  function xy(W, H, lon, lat) { return { x:((lon+180)/360)*W, y:((90-lat)/180)*H }; }

  function drawMini(ctx, W, H, t) {
    // Pure radial deep-space void — no paper, no texture
    const bg = ctx.createRadialGradient(W/2,H/2,0, W/2,H/2,Math.max(W,H)*0.75);
    bg.addColorStop(0,'#00080f'); bg.addColorStop(0.6,'#00050c'); bg.addColorStop(1,'#000208');
    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    _nebula(ctx, W, H, t);
    if (opts.grid)        _grid(ctx, W, H);
    StarField.draw(ctx, W, H, t, opts.stars);
    if (opts.terminator)  _terminator(ctx, W, H);
    _continents(ctx, W, H);
    if (opts.constellations) _constellations(ctx, W, H);
    if (opts.orbitPath)   _orbits(ctx, W, H);
    _trails(ctx, W, H);
    _satellites(ctx, W, H, t);
    if (_myLat !== null)  { _me(ctx, W, H); _lines(ctx, W, H); }
  }

  function _nebula(ctx, W, H, t) {
    const s = t * 0.000015;
    const g = ctx.createRadialGradient(W*0.25+Math.sin(s)*W*0.03, H*0.4, 0, W*0.25, H*0.4, W*0.3);
    g.addColorStop(0,'rgba(0,20,50,0.06)'); g.addColorStop(1,'transparent');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }

  function _grid(ctx, W, H) {
    ctx.strokeStyle='rgba(0,70,120,0.12)'; ctx.lineWidth=0.35;
    for(let lo=-180;lo<=180;lo+=30){const x=((lo+180)/360)*W;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let la=-90;la<=90;la+=30){const y=((90-la)/180)*H;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.strokeStyle='rgba(0,140,220,0.14)'; ctx.lineWidth=0.6;
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();
    ctx.fillStyle='rgba(0,90,150,0.28)'; ctx.font=`${Math.max(7,W*0.009)}px Rajdhani,sans-serif`;
    for(let lo=-150;lo<=180;lo+=60){ctx.fillText(lo+'°',((lo+180)/360)*W+2,H-3);}
  }

  function _terminator(ctx, W, H) {
    const now=new Date(), doy=Math.floor((now-new Date(now.getFullYear(),0,0))/86400000);
    const sLon=-((now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds())/86400)*360;
    const sLat=23.45*Math.sin((2*Math.PI/365)*(doy-81));
    const sx=((sLon+180+720)%360/360)*W, sy=((90-sLat)/180)*H;
    const g=ctx.createRadialGradient((sx+W/2)%W,H-sy,0,(sx+W/2)%W,H-sy,W*0.55);
    g.addColorStop(0,'rgba(0,3,10,0.52)');g.addColorStop(0.38,'rgba(0,3,10,0.24)');g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function _continents(ctx, W, H) {
    ctx.strokeStyle='rgba(0,120,200,0.1)'; ctx.lineWidth=0.6;
    for(const s of CONT){
      ctx.beginPath(); let st=false,lx=null;
      for(const [lo,la] of s){const p=xy(W,H,lo,la);if(!st){ctx.moveTo(p.x,p.y);st=true;lx=p.x;}else{if(Math.abs(p.x-lx)>W*0.5)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}}
      ctx.closePath(); ctx.stroke();
    }
  }

  function _constellations(ctx, W, H) {
    for(const c of CONSTELLATION_DATA){
      const pts=c.stars.map(([ra,dec])=>xy(W,H,ra-180,dec));
      ctx.strokeStyle='rgba(25,70,170,0.1)'; ctx.lineWidth=0.5;
      if(c.lines) for(const [a,b] of c.lines){if(!pts[a]||!pts[b]||Math.abs(pts[a].x-pts[b].x)>W*0.4)continue;ctx.beginPath();ctx.moveTo(pts[a].x,pts[a].y);ctx.lineTo(pts[b].x,pts[b].y);ctx.stroke();}
      for(const p of pts){ctx.globalAlpha=0.35;ctx.fillStyle='#6090c8';ctx.beginPath();ctx.arc(p.x,p.y,1.3,0,Math.PI*2);ctx.fill();}
      ctx.globalAlpha=1;
    }
  }

  function _orbits(ctx, W, H) {
    for(const [id, sat] of Object.entries(_sats)){
      if(!sat.orbit||sat.orbit.length<2||sat.offline) continue;
      const cat=SATELLITE_CATALOG[parseInt(id)]; if(!cat) continue;
      const col=_rgb(cat.color);
      ctx.strokeStyle=`rgba(${col},0.12)`; ctx.lineWidth=0.8; ctx.setLineDash([3,9]);
      let lx=null; ctx.beginPath();
      for(const [la,lo] of sat.orbit){const p=xy(W,H,lo,la);if(lx===null){ctx.moveTo(p.x,p.y);lx=p.x;}else{if(Math.abs(p.x-lx)>W*0.45)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}}
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  function _trails(ctx, W, H) {
    for(const [id, sat] of Object.entries(_sats)){
      if(!sat.trail||sat.trail.length<2||sat.offline) continue;
      const cat=SATELLITE_CATALOG[parseInt(id)]; if(!cat) continue;
      const col=_rgb(cat.color);
      for(let i=1;i<sat.trail.length;i++){
        const a=xy(W,H,sat.trail[i-1][1],sat.trail[i-1][0]);
        const b=xy(W,H,sat.trail[i][1],sat.trail[i][0]);
        if(Math.abs(a.x-b.x)>W*0.4) continue;
        const f=i/sat.trail.length;
        // Glow pass
        ctx.strokeStyle=`rgba(${col},${f*0.1})`; ctx.lineWidth=3.5;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
        // Sharp core trail
        ctx.strokeStyle=`rgba(${col},${f*0.7})`; ctx.lineWidth=1.3;
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      }
    }
  }

  function _satellites(ctx, W, H, t) {
    const pulse=0.5+0.5*Math.sin(t*0.0035);
    for(const [id, sat] of Object.entries(_sats)){
      const cat=SATELLITE_CATALOG[parseInt(id)]; if(!cat) continue;
      if(sat.offline){
        _drawOfflineSat(ctx, W, H, sat, cat, t);
        continue;
      }
      if(sat.lat===undefined) continue;
      const p=xy(W,H,sat.lon,sat.lat);
      const col=_rgb(cat.color);
      const isDemoSat = sat.demo === true;

      // Ambient glow
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,W*0.035);
      g.addColorStop(0,`rgba(${col},${isDemoSat?0.07:0.14})`); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);

      // Ring
      ctx.strokeStyle=`rgba(${col},${0.15*pulse})`; ctx.lineWidth=0.7;
      ctx.beginPath();ctx.arc(p.x,p.y,W*0.02,0,Math.PI*2);ctx.stroke();

      // Crosshair
      const cs=W*0.014;
      ctx.shadowColor=cat.color; ctx.shadowBlur=isDemoSat?3:6;
      ctx.strokeStyle=`rgba(${col},${isDemoSat?0.5:0.85})`; ctx.lineWidth=1.0;
      const gap=cs*0.28;
      ctx.beginPath();
      ctx.moveTo(p.x-cs,p.y);ctx.lineTo(p.x-gap,p.y);ctx.moveTo(p.x+gap,p.y);ctx.lineTo(p.x+cs,p.y);
      ctx.moveTo(p.x,p.y-cs);ctx.lineTo(p.x,p.y-gap);ctx.moveTo(p.x,p.y+gap);ctx.lineTo(p.x,p.y+cs);
      ctx.stroke();ctx.shadowBlur=0;

      // Dot
      ctx.fillStyle=`rgba(${col},${isDemoSat?0.6:0.9})`;
      ctx.beginPath();ctx.arc(p.x,p.y,2+pulse,0,Math.PI*2);ctx.fill();

      // Label
      ctx.fillStyle=`rgba(${col},${isDemoSat?0.5:0.75})`;
      ctx.font=`${Math.max(7,W*0.008)}px Rajdhani,sans-serif`;
      ctx.fillText(cat.short+(isDemoSat?' ⟳':''), p.x+cs+3, p.y-5);
    }
  }

  function _drawOfflineSat(ctx, W, H, sat, cat, t) {
    // Show ghost at last known position, or skip if never seen
    const lastPos = sat.trail && sat.trail.length ? sat.trail[sat.trail.length-1] : null;
    if(!lastPos) return;
    const p=xy(W,H,lastPos[1],lastPos[0]);
    ctx.strokeStyle='rgba(80,80,100,0.25)'; ctx.lineWidth=0.7;
    ctx.beginPath();ctx.arc(p.x,p.y,W*0.015,0,Math.PI*2);ctx.stroke();
    const cs=W*0.01;
    ctx.strokeStyle='rgba(80,80,100,0.2)'; ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(p.x-cs,p.y);ctx.lineTo(p.x+cs,p.y);ctx.moveTo(p.x,p.y-cs);ctx.lineTo(p.x,p.y+cs);ctx.stroke();
    ctx.fillStyle='rgba(80,80,100,0.35)'; ctx.font=`${Math.max(7,W*0.0075)}px Rajdhani,sans-serif`;
    ctx.fillText(cat.short+' ?', p.x+cs+2, p.y-4);
  }

  function _me(ctx, W, H) {
    const p=xy(W,H,_myLon,_myLat);
    ctx.shadowColor='#ffaa00'; ctx.shadowBlur=7;
    ctx.strokeStyle='rgba(255,170,0,0.75)'; ctx.lineWidth=1.1;
    const s=W*0.012;
    ctx.beginPath();ctx.moveTo(p.x-s,p.y);ctx.lineTo(p.x+s,p.y);ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x,p.y+s);ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,170,0,0.7)'; ctx.font=`${Math.max(7,W*0.008)}px Rajdhani,sans-serif`;
    ctx.fillText('YOU', p.x+s+3, p.y-4);
  }

  function _lines(ctx, W, H) {
    const a=xy(W,H,_myLon,_myLat);
    for(const [id,sat] of Object.entries(_sats)){
      if(sat.offline||sat.lat===undefined) continue;
      const b=xy(W,H,sat.lon,sat.lat);
      if(Math.abs(a.x-b.x)>W*0.5) continue;
      const cat=SATELLITE_CATALOG[parseInt(id)]; if(!cat) continue;
      const col=_rgb(cat.color);
      const gl=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
      gl.addColorStop(0,'rgba(255,170,0,0.09)');gl.addColorStop(1,`rgba(${col},0.04)`);
      ctx.strokeStyle=gl; ctx.lineWidth=0.65; ctx.setLineDash([2,9]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function _rgb(h){ return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)].join(','); }
  function getISSScreenPos(W,H){ const s=_sats[25544]; if(!s||s.offline) return null; return xy(W,H,s.lon,s.lat); }

  return { drawMini, setOpts, setSatellites, setMyLocation, getISSScreenPos };
})();

// Continent shapes
const CONT=[
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]],
];
