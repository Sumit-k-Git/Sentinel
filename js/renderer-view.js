// renderer-view.js — Full-screen ambient projection renderer (v3, multi-sat, no paper bg)

window.RendererView = (function(){
  let canvas, ctx, W, H;
  let satellites = {};
  let myLat=null, myLon=null;
  let currentPOV='my_location';

  const opts = { stars:true, constellations:true, grid:true, terminator:true, orbitPath:true, weather:true };

  function init(c){ canvas=c; ctx=canvas.getContext('2d'); resize(); }
  function resize(){ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; }
  function setOpts(o){ Object.assign(opts,o); }
  function setSatellites(s){ satellites=s; }
  function setMyLocation(la,lo){ myLat=la; myLon=lo; }
  function setPOV(p){ currentPOV=p; }

  function xy(lon,lat){ return { x:((lon+180)/360)*W, y:((90-lat)/180)*H }; }

  function draw(t){
    // Pure void — no paper, no texture, just deep space
    const bg = ctx.createRadialGradient(W/2,H/2,0, W/2,H/2,Math.max(W,H)*0.8);
    bg.addColorStop(0,'#00080f');
    bg.addColorStop(0.5,'#00050c');
    bg.addColorStop(1,'#000208');
    ctx.fillStyle=bg;
    ctx.fillRect(0,0,W,H);

    drawNebula(t);
    if(opts.grid) drawGrid();
    StarField.draw(ctx,W,H,t,opts.stars);
    if(opts.terminator) drawTerminator();
    drawContinents();
    if(opts.constellations) drawConstellations(t);
    if(opts.weather) WeatherLayer.draw(ctx,W,H,myLat,myLon);
    if(opts.orbitPath) drawAllOrbits(t);
    drawAllTrails(t);
    drawAllSatellites(t);
    if(myLat!==null){ drawMyLocation(); }

    // POV-specific overlays
    if(currentPOV==='my_location' && myLat!==null) drawLocationRings(t);
    if(currentPOV!=='my_location' && currentPOV!=='global'){
      const focusSat = satellites[parseInt(currentPOV)];
      if(focusSat) drawFocusFrame(focusSat, t);
    }
  }

  function drawNebula(t){
    const s=t*0.000018;
    // nebula blobs — pure dark space tones only
    const blobs=[
      {x:W*0.2, y:H*0.3, r:W*0.35, c:'rgba(0,20,50,0.055)', drift:[0.04,0.03]},
      {x:W*0.75,y:H*0.6, r:W*0.30, c:'rgba(20,0,50,0.04)',  drift:[0.03,0.05]},
      {x:W*0.5, y:H*0.15,r:W*0.25, c:'rgba(0,30,60,0.04)',  drift:[0.05,0.02]},
    ];
    for(const b of blobs){
      const bx=b.x+Math.sin(s*b.drift[0])*W*0.03;
      const by=b.y+Math.cos(s*b.drift[1])*H*0.03;
      const g=ctx.createRadialGradient(bx,by,0,bx,by,b.r);
      g.addColorStop(0,b.c); g.addColorStop(1,'transparent');
      ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    }
  }

  function drawGrid(){
    ctx.lineWidth=0.35;
    ctx.strokeStyle='rgba(0,70,120,0.12)';
    for(let lon=-180;lon<=180;lon+=30){
      const x=((lon+180)/360)*W;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for(let lat=-90;lat<=90;lat+=30){
      const y=((90-lat)/180)*H;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    // Equator accent
    ctx.strokeStyle='rgba(0,140,220,0.15)'; ctx.lineWidth=0.7;
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
    // Labels
    ctx.fillStyle='rgba(0,90,150,0.28)';
    ctx.font=`${Math.max(8,W*0.0082)}px Rajdhani,sans-serif`;
    for(let lon=-150;lon<=180;lon+=60){
      const x=((lon+180)/360)*W;
      ctx.fillText(lon+'°', x+2, H-5);
    }
    for(let lat=-60;lat<=90;lat+=30){
      if(lat===0) continue;
      const y=((90-lat)/180)*H;
      ctx.fillText(lat+'°', 2, y-2);
    }
    ctx.fillStyle='rgba(0,180,255,0.35)';
    ctx.fillText('0°', 2, H/2-2);
  }

  function drawTerminator(){
    const now=new Date();
    const doy=Math.floor((now-new Date(now.getFullYear(),0,0))/86400000);
    const sLon=-((now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds())/86400)*360;
    const sLat=23.45*Math.sin((2*Math.PI/365)*(doy-81));
    const sx=((sLon+180+720)%360/360)*W;
    const sy=((90-sLat)/180)*H;
    const antiX=(sx+W/2)%W, antiY=H-sy;
    const g=ctx.createRadialGradient(antiX,antiY,0,antiX,antiY,W*0.58);
    g.addColorStop(0,'rgba(0,3,10,0.58)');
    g.addColorStop(0.38,'rgba(0,3,10,0.28)');
    g.addColorStop(0.68,'rgba(0,3,10,0.07)');
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function drawContinents(){
    ctx.strokeStyle='rgba(0,120,200,0.1)'; ctx.lineWidth=0.65;
    for(const shape of CONTINENT_SHAPES){
      ctx.beginPath(); let started=false, lx=null;
      for(const [lo,la] of shape){
        const p=xy(lo,la);
        if(!started){ctx.moveTo(p.x,p.y);started=true;lx=p.x;}
        else{if(Math.abs(p.x-lx)>W*0.5)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}
      }
      ctx.closePath(); ctx.stroke();
    }
  }

  function drawConstellations(t){
    for(const c of window.CONSTELLATION_DATA){
      const pts=c.stars.map(([ra,dec])=>xy(ra-180,dec));
      ctx.strokeStyle='rgba(25,70,170,0.11)'; ctx.lineWidth=0.6;
      if(c.lines) for(const [a,b] of c.lines){
        if(!pts[a]||!pts[b]||Math.abs(pts[a].x-pts[b].x)>W*0.4) continue;
        ctx.beginPath(); ctx.moveTo(pts[a].x,pts[a].y); ctx.lineTo(pts[b].x,pts[b].y); ctx.stroke();
      }
      for(const p of pts){
        ctx.globalAlpha=0.38; ctx.fillStyle='#6a9fd8';
        ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=0.13; ctx.fillStyle='#5580c0';
      ctx.font=`${Math.max(7,W*0.007)}px Rajdhani,sans-serif`;
      if(pts[0]) ctx.fillText(c.name,pts[0].x+4,pts[0].y-4);
      ctx.globalAlpha=1;
    }
  }

  function drawAllOrbits(t){
    for(const [idStr,sat] of Object.entries(satellites)){
      if(!sat.orbit||sat.orbit.length<2) continue;
      const cat=SATELLITE_CATALOG[parseInt(idStr)];
      if(!cat) continue;
      const col=hexToRgb(cat.color);
      // Wide glow
      ctx.strokeStyle=`rgba(${col},0.07)`; ctx.lineWidth=4; ctx.setLineDash([4,12]);
      drawOrbitPath(sat.orbit);
      // Sharp line
      ctx.strokeStyle=`rgba(${col},0.2)`; ctx.lineWidth=0.9; ctx.setLineDash([3,9]);
      drawOrbitPath(sat.orbit);
      ctx.setLineDash([]);
    }
  }

  function drawOrbitPath(orbit){
    let lx=null; ctx.beginPath();
    for(const [la,lo] of orbit){
      const p=xy(lo,la);
      if(lx===null){ctx.moveTo(p.x,p.y);lx=p.x;}
      else{if(Math.abs(p.x-lx)>W*0.45)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}
    }
    ctx.stroke();
  }

  function drawAllTrails(t){
    for(const [idStr,sat] of Object.entries(satellites)){
      if(!sat.trail||sat.trail.length<2) continue;
      const cat=SATELLITE_CATALOG[parseInt(idStr)];
      if(!cat) continue;
      const col=hexToRgb(cat.color);
      for(let i=1;i<sat.trail.length;i++){
        const a=xy(sat.trail[i-1][1],sat.trail[i-1][0]);
        const b=xy(sat.trail[i][1],sat.trail[i][0]);
        if(Math.abs(a.x-b.x)>W*0.4) continue;
        const frac=i/sat.trail.length;
        ctx.strokeStyle=`rgba(${col},${frac*0.08})`; ctx.lineWidth=4;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.strokeStyle=`rgba(${col},${frac*0.7})`; ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    }
  }

  function drawAllSatellites(t){
    const pulse=0.5+0.5*Math.sin(t*0.0035);
    const pulse2=0.5+0.5*Math.sin(t*0.005+1);
    for(const [idStr,sat] of Object.entries(satellites)){
      if(!sat.lat&&sat.lat!==0) continue;
      const id=parseInt(idStr);
      const cat=SATELLITE_CATALOG[id];
      if(!cat) continue;
      const isFocused=(currentPOV===idStr||currentPOV===id||currentPOV==='global'||currentPOV==='my_location');
      drawSatellite(sat, cat, pulse, pulse2, isFocused, t);
    }
  }

  function drawSatellite(sat, cat, pulse, pulse2, focused, t){
    const p=xy(sat.lon,sat.lat);
    const col=hexToRgb(cat.color);
    const alpha = focused?1:0.45;

    // Outer ambient glow
    const rOuter=focused?(W*0.025+W*0.006*pulse):(W*0.012);
    const gOuter=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,rOuter);
    gOuter.addColorStop(0,`rgba(${col},${0.08*alpha})`);
    gOuter.addColorStop(1,'transparent');
    ctx.fillStyle=gOuter; ctx.fillRect(0,0,W,H);

    // Sonar rings
    const rings=focused?4:2;
    for(let r=1;r<=rings;r++){
      const rr=(r*W*0.016)*(0.75+0.25*pulse);
      const a=((rings+1-r)/(rings+1))*0.14*pulse2*alpha;
      ctx.strokeStyle=`rgba(${col},${a})`; ctx.lineWidth=0.75;
      ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,Math.PI*2); ctx.stroke();
    }

    // Crosshair
    const cs=focused?(W*0.016):(W*0.008);
    ctx.shadowColor=cat.color; ctx.shadowBlur=focused?12:5;
    ctx.strokeStyle=`rgba(${col},${0.9*alpha})`; ctx.lineWidth=focused?1.2:0.8;
    const gap=cs*0.28;
    ctx.beginPath();
    ctx.moveTo(p.x-cs,p.y); ctx.lineTo(p.x-gap,p.y);
    ctx.moveTo(p.x+gap,p.y); ctx.lineTo(p.x+cs,p.y);
    ctx.moveTo(p.x,p.y-cs); ctx.lineTo(p.x,p.y-gap);
    ctx.moveTo(p.x,p.y+gap); ctx.lineTo(p.x,p.y+cs);
    ctx.stroke();
    if(focused){
      // 45° ticks
      const d=cs*0.38;
      ctx.strokeStyle=`rgba(${col},0.3)`; ctx.lineWidth=0.65;
      ctx.beginPath();
      ctx.moveTo(p.x-d,p.y-d);ctx.lineTo(p.x-d*0.5,p.y-d*0.5);
      ctx.moveTo(p.x+d,p.y-d);ctx.lineTo(p.x+d*0.5,p.y-d*0.5);
      ctx.moveTo(p.x-d,p.y+d);ctx.lineTo(p.x-d*0.5,p.y+d*0.5);
      ctx.moveTo(p.x+d,p.y+d);ctx.lineTo(p.x+d*0.5,p.y+d*0.5);
      ctx.stroke();
    }
    ctx.shadowBlur=0;

    // Core dot
    const dotR=(focused?3.5:2)+( focused?1.2*pulse:0);
    const gc=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,dotR*2.5);
    gc.addColorStop(0,`rgba(255,255,255,${0.95*alpha})`);
    gc.addColorStop(0.4,`rgba(${col},${0.9*alpha})`);
    gc.addColorStop(1,'transparent');
    ctx.fillStyle=gc; ctx.beginPath(); ctx.arc(p.x,p.y,dotR*2.5,0,Math.PI*2); ctx.fill();

    // Label
    if(focused||Object.keys(satellites).length<=4){
      ctx.fillStyle=`rgba(${col},${0.85*alpha})`;
      ctx.font=`${focused?'bold ':''} ${Math.max(8,W*(focused?0.009:0.007))}px Rajdhani,sans-serif`;
      ctx.fillText(cat.short, p.x+cs+4, p.y-5);
      if(focused){
        ctx.fillStyle=`rgba(${col},0.45)`;
        ctx.font=`${Math.max(7,W*0.0072)}px Rajdhani,sans-serif`;
        ctx.fillText(`${sat.alt?sat.alt.toFixed(0):'—'} km`, p.x+cs+4, p.y+9);
      }
    }
  }

  function drawMyLocation(){
    const p=xy(myLon,myLat);
    ctx.shadowColor='#ffaa00'; ctx.shadowBlur=10;
    ctx.strokeStyle='rgba(255,170,0,0.8)'; ctx.lineWidth=1.3;
    const s=W*0.011;
    ctx.beginPath();
    ctx.moveTo(p.x-s,p.y);ctx.lineTo(p.x+s,p.y);
    ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x,p.y+s);
    ctx.stroke();
    // diamond
    ctx.strokeStyle='rgba(255,170,0,0.35)'; ctx.lineWidth=0.75;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-s*0.7);ctx.lineTo(p.x+s*0.7,p.y);
    ctx.lineTo(p.x,p.y+s*0.7);ctx.lineTo(p.x-s*0.7,p.y);
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,200,80,0.75)';
    ctx.font=`bold ${Math.max(8,W*0.008)}px Rajdhani,sans-serif`;
    ctx.fillText('YOU', p.x+s+4, p.y-4);
    // Pull lines to each tracked sat
    for(const [idStr,sat] of Object.entries(satellites)){
      if(!sat.lat&&sat.lat!==0) continue;
      const cat=SATELLITE_CATALOG[parseInt(idStr)];
      if(!cat) continue;
      const b=xy(sat.lon,sat.lat);
      if(Math.abs(p.x-b.x)>W*0.5) continue;
      const col=hexToRgb(cat.color);
      const gl=ctx.createLinearGradient(p.x,p.y,b.x,b.y);
      gl.addColorStop(0,'rgba(255,170,0,0.1)'); gl.addColorStop(1,`rgba(${col},0.05)`);
      ctx.strokeStyle=gl; ctx.lineWidth=0.7; ctx.setLineDash([2,9]);
      ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawLocationRings(t){
    // Pulsing rings around user location showing coverage radius
    const p=xy(myLon,myLat);
    const pulse=0.5+0.5*Math.sin(t*0.0015);
    for(let r=1;r<=3;r++){
      const rr=(r*W*0.055)*(0.85+0.15*pulse);
      ctx.strokeStyle=`rgba(255,170,0,${((4-r)/4)*0.06*pulse})`;
      ctx.lineWidth=0.8; ctx.setLineDash([4,10]);
      ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,Math.PI*2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  function drawFocusFrame(sat, t){
    // Subtle corner brackets around focused satellite
    const p=xy(sat.lon,sat.lat);
    const size=50, arm=14;
    const pulse=0.5+0.5*Math.sin(t*0.003);
    ctx.strokeStyle=`rgba(0,255,229,${0.3*pulse})`; ctx.lineWidth=1.2;
    const corners=[[-1,-1],[1,-1],[-1,1],[1,1]];
    for(const [sx,sy] of corners){
      const cx=p.x+sx*size, cy=p.y+sy*size;
      ctx.beginPath();
      ctx.moveTo(cx,cy+sy*(-arm)); ctx.lineTo(cx,cy); ctx.lineTo(cx+sx*(-arm),cy);
      ctx.stroke();
    }
  }

  function hexToRgb(hex){
    const r=parseInt(hex.slice(1,3),16);
    const g=parseInt(hex.slice(3,5),16);
    const b=parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  }

  function getScreenPos(lon,lat){ return xy(lon,lat); }

  return { init, resize, draw, setOpts, setSatellites, setMyLocation, setPOV, getScreenPos };
})();

// ── Continent outlines ─────────────────────────────────────────────────────
const CONTINENT_SHAPES=[
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]],
];
