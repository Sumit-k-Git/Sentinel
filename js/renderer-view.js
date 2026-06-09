// renderer-view.js — Full-screen ambient projection renderer

window.RendererView = (function(){
  let canvas, ctx, W, H;
  let issLat=0, issLon=0;
  let issTrail=[], issOrbit=[];
  let myLat=null, myLon=null;

  const opts = { stars:true, constellations:true, grid:true, terminator:true, orbitPath:true, glow:true };

  function init(c){ canvas=c; ctx=canvas.getContext('2d'); resize(); }
  function resize(){ W=canvas.width=window.innerWidth; H=canvas.height=window.innerHeight; }
  function setOpts(o){ Object.assign(opts,o); }
  function setISS(la,lo){ issLat=la; issLon=lo; }
  function setTrail(t){ issTrail=t; }
  function setOrbit(o){ issOrbit=o; }
  function setMyLocation(la,lo){ myLat=la; myLon=lo; }

  function xy(lon,lat){ return { x:((lon+180)/360)*W, y:((90-lat)/180)*H }; }

  function draw(t){
    // Deep space background with subtle nebula
    ctx.fillStyle='#00040a';
    ctx.fillRect(0,0,W,H);
    drawNebulaAmbience(t);
    if(opts.grid) drawGrid();
    StarField.draw(ctx,W,H,t,opts.stars);
    if(opts.terminator) drawTerminator();
    drawContinents();
    if(opts.constellations) drawConstellations(t);
    if(opts.orbitPath) drawOrbit();
    drawTrail(t);
    drawISSGlow(t);
    if(myLat!==null){ drawLocation(); drawPullLine(); }
  }

  function drawNebulaAmbience(t){
    // Subtle drifting nebula clouds
    const cx=W*0.3, cy=H*0.4;
    const s=t*0.00003;
    const g1=ctx.createRadialGradient(cx+Math.sin(s)*W*0.05, cy+Math.cos(s)*H*0.05, 0, cx, cy, W*0.4);
    g1.addColorStop(0,'rgba(0,40,80,0.06)');
    g1.addColorStop(0.5,'rgba(0,20,50,0.03)');
    g1.addColorStop(1,'transparent');
    ctx.fillStyle=g1; ctx.fillRect(0,0,W,H);

    const cx2=W*0.75, cy2=H*0.65;
    const g2=ctx.createRadialGradient(cx2+Math.cos(s*0.7)*W*0.04, cy2+Math.sin(s*0.7)*H*0.04, 0, cx2, cy2, W*0.35);
    g2.addColorStop(0,'rgba(60,0,100,0.04)');
    g2.addColorStop(1,'transparent');
    ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);
  }

  function drawGrid(){
    ctx.lineWidth=0.4;
    // Regular grid
    ctx.strokeStyle='rgba(0,80,130,0.12)';
    for(let lon=-180;lon<=180;lon+=30){
      const x=((lon+180)/360)*W;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for(let lat=-90;lat<=90;lat+=30){
      const y=((90-lat)/180)*H;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    // Equator accent
    const eq=H/2;
    ctx.strokeStyle='rgba(0,150,220,0.18)';
    ctx.lineWidth=0.8;
    ctx.beginPath(); ctx.moveTo(0,eq); ctx.lineTo(W,eq); ctx.stroke();
    // Prime meridian
    const pm=W/2;
    ctx.strokeStyle='rgba(0,150,220,0.12)';
    ctx.beginPath(); ctx.moveTo(pm,0); ctx.lineTo(pm,H); ctx.stroke();

    ctx.fillStyle='rgba(0,100,160,0.28)';
    ctx.font=`${Math.max(8,W*0.0085)}px Rajdhani,sans-serif`;
    for(let lon=-150;lon<=180;lon+=60){
      const x=((lon+180)/360)*W;
      ctx.fillText(lon+'°',x+2,H-4);
    }
    for(let lat=-60;lat<=90;lat+=30){
      const y=((90-lat)/180)*H; if(lat===0) continue;
      ctx.fillText(lat+'°',2,y-2);
    }
    ctx.fillStyle='rgba(0,190,255,0.4)';
    ctx.fillText('0°',2,H/2-2);
  }

  function drawTerminator(){
    const now=new Date();
    const doy=Math.floor((now-new Date(now.getFullYear(),0,0))/86400000);
    const sunLon=-((now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds())/86400)*360;
    const sunLat=23.45*Math.sin((2*Math.PI/365)*(doy-81));
    const sx=((sunLon+180+720)%360/360)*W;
    const sy=((90-sunLat)/180)*H;
    const antiX=(sx+W/2)%W;
    const antiY=H-sy;
    const g=ctx.createRadialGradient(antiX,antiY,0,antiX,antiY,W*0.6);
    g.addColorStop(0,'rgba(0,4,12,0.6)');
    g.addColorStop(0.35,'rgba(0,4,12,0.35)');
    g.addColorStop(0.65,'rgba(0,4,12,0.08)');
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function drawContinents(){
    ctx.strokeStyle='rgba(0,130,210,0.1)';
    ctx.lineWidth=0.7;
    for(const shape of CONTINENT_SHAPES){
      ctx.beginPath();
      let started=false, lastX=null;
      for(const [lon,lat] of shape){
        const p=xy(lon,lat);
        if(!started){ ctx.moveTo(p.x,p.y); started=true; lastX=p.x; }
        else{ if(Math.abs(p.x-lastX)>W*0.5) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); lastX=p.x; }
      }
      ctx.closePath(); ctx.stroke();
    }
  }

  function drawConstellations(t){
    for(const c of window.CONSTELLATION_DATA){
      const pts=c.stars.map(([ra,dec])=>xy(ra-180,dec));
      ctx.strokeStyle='rgba(30,80,180,0.12)';
      ctx.lineWidth=0.6;
      if(c.lines){
        for(const [a,b] of c.lines){
          if(!pts[a]||!pts[b]) continue;
          if(Math.abs(pts[a].x-pts[b].x)>W*0.4) continue;
          ctx.beginPath(); ctx.moveTo(pts[a].x,pts[a].y); ctx.lineTo(pts[b].x,pts[b].y); ctx.stroke();
        }
      }
      for(const p of pts){
        ctx.globalAlpha=0.4;
        ctx.fillStyle='#7aa8d8';
        ctx.beginPath(); ctx.arc(p.x,p.y,1.6,0,Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha=0.14;
      ctx.fillStyle='#5580b0';
      ctx.font=`${Math.max(7,W*0.0072)}px Rajdhani,sans-serif`;
      if(pts[0]) ctx.fillText(c.name,pts[0].x+4,pts[0].y-4);
      ctx.globalAlpha=1;
    }
  }

  function drawOrbit(){
    if(issOrbit.length<2) return;
    // Glow pass
    ctx.strokeStyle='rgba(0,255,229,0.06)';
    ctx.lineWidth=3;
    ctx.setLineDash([4,10]);
    _drawOrbitPath();
    // Core line
    ctx.strokeStyle='rgba(0,255,229,0.18)';
    ctx.lineWidth=1;
    ctx.setLineDash([3,8]);
    _drawOrbitPath();
    ctx.setLineDash([]);
  }

  function _drawOrbitPath(){
    let lastX=null;
    ctx.beginPath();
    for(let i=0;i<issOrbit.length;i++){
      const p=xy(issOrbit[i][1],issOrbit[i][0]);
      if(lastX===null){ ctx.moveTo(p.x,p.y); lastX=p.x; }
      else{ if(Math.abs(p.x-lastX)>W*0.45) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); lastX=p.x; }
    }
    ctx.stroke();
  }

  function drawTrail(t){
    if(issTrail.length<2) return;
    for(let i=1;i<issTrail.length;i++){
      const a=xy(issTrail[i-1][1],issTrail[i-1][0]);
      const b=xy(issTrail[i][1],issTrail[i][0]);
      if(Math.abs(a.x-b.x)>W*0.4) continue;
      const frac=i/issTrail.length;
      // Glow trail
      ctx.strokeStyle=`rgba(0,255,229,${frac*0.12})`;
      ctx.lineWidth=4;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      // Core trail
      ctx.strokeStyle=`rgba(0,255,229,${frac*0.65})`;
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
  }

  function drawISSGlow(t){
    const p=xy(issLon,issLat);
    const pulse=0.5+0.5*Math.sin(t*0.0035);
    const pulse2=0.5+0.5*Math.sin(t*0.0025+1);

    // Outer ambient glow
    const r1=W*0.035+W*0.008*pulse;
    const g1=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r1);
    g1.addColorStop(0,'rgba(0,255,229,0.06)');
    g1.addColorStop(0.4,'rgba(0,255,229,0.02)');
    g1.addColorStop(1,'transparent');
    ctx.fillStyle=g1; ctx.fillRect(0,0,W,H);

    // Mid glow
    const r2=W*0.018;
    const g2=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r2);
    g2.addColorStop(0,'rgba(0,255,229,0.18)');
    g2.addColorStop(0.5,'rgba(0,255,229,0.04)');
    g2.addColorStop(1,'transparent');
    ctx.fillStyle=g2; ctx.fillRect(0,0,W,H);

    // Sonar rings
    for(let r=1;r<=5;r++){
      const rr=(r*W*0.02)*(0.7+0.3*pulse);
      const alpha=((6-r)/6)*0.15*pulse2;
      ctx.strokeStyle=`rgba(0,255,229,${alpha})`;
      ctx.lineWidth=0.8;
      ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,Math.PI*2); ctx.stroke();
    }

    // Crosshair with glow
    const cs=W*0.018;
    ctx.shadowColor='#00ffe5';
    ctx.shadowBlur=12;
    ctx.strokeStyle='rgba(0,255,229,0.9)';
    ctx.lineWidth=1.2;
    ctx.beginPath();
    ctx.moveTo(p.x-cs,p.y); ctx.lineTo(p.x-cs*0.25,p.y);
    ctx.moveTo(p.x+cs*0.25,p.y); ctx.lineTo(p.x+cs,p.y);
    ctx.moveTo(p.x,p.y-cs); ctx.lineTo(p.x,p.y-cs*0.25);
    ctx.moveTo(p.x,p.y+cs*0.25); ctx.lineTo(p.x,p.y+cs);
    ctx.stroke();
    // 45° tick marks
    const d45=cs*0.4;
    ctx.strokeStyle='rgba(0,255,229,0.35)';
    ctx.lineWidth=0.7;
    ctx.beginPath();
    ctx.moveTo(p.x-d45,p.y-d45); ctx.lineTo(p.x-d45*0.5,p.y-d45*0.5);
    ctx.moveTo(p.x+d45,p.y-d45); ctx.lineTo(p.x+d45*0.5,p.y-d45*0.5);
    ctx.moveTo(p.x-d45,p.y+d45); ctx.lineTo(p.x-d45*0.5,p.y+d45*0.5);
    ctx.moveTo(p.x+d45,p.y+d45); ctx.lineTo(p.x+d45*0.5,p.y+d45*0.5);
    ctx.stroke();
    ctx.shadowBlur=0;

    // Core dot
    const coreR=3+1.5*pulse;
    const gc=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,coreR*2);
    gc.addColorStop(0,'rgba(255,255,255,0.95)');
    gc.addColorStop(0.3,'rgba(0,255,229,0.9)');
    gc.addColorStop(1,'transparent');
    ctx.fillStyle=gc;
    ctx.beginPath(); ctx.arc(p.x,p.y,coreR*2,0,Math.PI*2); ctx.fill();
  }

  function drawLocation(){
    const p=xy(myLon,myLat);
    ctx.shadowColor='#ffaa00';
    ctx.shadowBlur=10;
    ctx.strokeStyle='rgba(255,170,0,0.8)';
    ctx.lineWidth=1.2;
    const s=W*0.01;
    ctx.beginPath();
    ctx.moveTo(p.x-s,p.y); ctx.lineTo(p.x+s,p.y);
    ctx.moveTo(p.x,p.y-s); ctx.lineTo(p.x,p.y+s);
    ctx.stroke();
    // Diamond
    ctx.strokeStyle='rgba(255,170,0,0.4)';
    ctx.lineWidth=0.8;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-s*0.7); ctx.lineTo(p.x+s*0.7,p.y);
    ctx.lineTo(p.x,p.y+s*0.7); ctx.lineTo(p.x-s*0.7,p.y);
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur=0;
  }

  function drawPullLine(){
    const a=xy(myLon,myLat);
    const b=xy(issLon,issLat);
    if(Math.abs(a.x-b.x)>W*0.5) return;
    const g=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
    g.addColorStop(0,'rgba(255,170,0,0.12)');
    g.addColorStop(1,'rgba(0,255,229,0.06)');
    ctx.strokeStyle=g;
    ctx.lineWidth=0.8;
    ctx.setLineDash([2,8]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  function getISSScreenPos(){ return xy(issLon,issLat); }

  return { init, resize, draw, setOpts, setISS, setTrail, setOrbit, setMyLocation, getISSScreenPos };
})();

// Continent shapes (same as renderer.js)
const CONTINENT_SHAPES=[
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]],
];
