// renderer.js — Mini map renderer for control panel + shared state

window.Renderer = (function(){
  let issLat=0, issLon=0;
  let issTrail=[], issOrbit=[];
  let myLat=null, myLon=null;
  const opts={stars:true,constellations:true,grid:true,terminator:true,orbitPath:true};

  function setOpts(o){ Object.assign(opts,o); }
  function setISS(la,lo){ issLat=la; issLon=lo; }
  function setTrail(t){ issTrail=t; }
  function setOrbit(o){ issOrbit=o; }
  function setMyLocation(la,lo){ myLat=la; myLon=lo; }
  function getISSScreenPos(W,H){ return W?{x:((issLon+180)/360)*W,y:((90-issLat)/180)*H}:null; }

  function xy(W,H,lon,lat){ return {x:((lon+180)/360)*W,y:((90-lat)/180)*H}; }

  function drawMini(ctx,W,H,t){
    ctx.fillStyle='#00040a'; ctx.fillRect(0,0,W,H);
    drawNebula(ctx,W,H,t);
    if(opts.grid) drawGrid(ctx,W,H);
    StarField.draw(ctx,W,H,t,opts.stars);
    if(opts.terminator) drawTerminator(ctx,W,H);
    drawContinents(ctx,W,H);
    if(opts.constellations) drawConstellations(ctx,W,H,t);
    if(opts.orbitPath) drawOrbit(ctx,W,H);
    drawTrail(ctx,W,H);
    drawISS(ctx,W,H,t);
    if(myLat!==null){ drawMe(ctx,W,H); drawLine(ctx,W,H); }
  }

  function drawNebula(ctx,W,H,t){
    const s=t*0.00002;
    const g=ctx.createRadialGradient(W*0.25+Math.sin(s)*W*0.04,H*0.35,0,W*0.25,H*0.35,W*0.3);
    g.addColorStop(0,'rgba(0,40,80,0.07)'); g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function drawGrid(ctx,W,H){
    ctx.strokeStyle='rgba(0,80,130,0.13)'; ctx.lineWidth=0.4;
    for(let lo=-180;lo<=180;lo+=30){const x=((lo+180)/360)*W;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let la=-90;la<=90;la+=30){const y=((90-la)/180)*H;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
    ctx.strokeStyle='rgba(0,150,220,0.18)';ctx.lineWidth=0.7;
    ctx.beginPath();ctx.moveTo(0,H/2);ctx.lineTo(W,H/2);ctx.stroke();
    ctx.fillStyle='rgba(0,100,160,0.3)'; ctx.font=`${Math.max(7,W*0.009)}px Rajdhani,sans-serif`;
    for(let lo=-150;lo<=180;lo+=60){const x=((lo+180)/360)*W;ctx.fillText(lo+'°',x+2,H-3);}
    for(let la=-60;la<=90;la+=30){if(la===0)continue;const y=((90-la)/180)*H;ctx.fillText(la+'°',2,y-2);}
  }

  function drawTerminator(ctx,W,H){
    const now=new Date();
    const doy=Math.floor((now-new Date(now.getFullYear(),0,0))/86400000);
    const sLon=-((now.getUTCHours()*3600+now.getUTCMinutes()*60+now.getUTCSeconds())/86400)*360;
    const sLat=23.45*Math.sin((2*Math.PI/365)*(doy-81));
    const sx=((sLon+180+720)%360/360)*W, sy=((90-sLat)/180)*H;
    const g=ctx.createRadialGradient((sx+W/2)%W,H-sy,0,(sx+W/2)%W,H-sy,W*0.55);
    g.addColorStop(0,'rgba(0,4,12,0.55)');g.addColorStop(0.4,'rgba(0,4,12,0.25)');g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
  }

  function drawContinents(ctx,W,H){
    ctx.strokeStyle='rgba(0,130,210,0.1)'; ctx.lineWidth=0.6;
    for(const s of CONTINENT_SHAPES){
      ctx.beginPath(); let started=false,lx=null;
      for(const [lo,la] of s){
        const p=xy(W,H,lo,la);
        if(!started){ctx.moveTo(p.x,p.y);started=true;lx=p.x;}
        else{if(Math.abs(p.x-lx)>W*0.5)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}
      }
      ctx.closePath(); ctx.stroke();
    }
  }

  function drawConstellations(ctx,W,H,t){
    for(const c of window.CONSTELLATION_DATA){
      const pts=c.stars.map(([ra,dec])=>xy(W,H,ra-180,dec));
      ctx.strokeStyle='rgba(30,80,180,0.1)'; ctx.lineWidth=0.5;
      if(c.lines) for(const [a,b] of c.lines){
        if(!pts[a]||!pts[b]) continue;
        if(Math.abs(pts[a].x-pts[b].x)>W*0.4) continue;
        ctx.beginPath(); ctx.moveTo(pts[a].x,pts[a].y); ctx.lineTo(pts[b].x,pts[b].y); ctx.stroke();
      }
      for(const p of pts){ ctx.globalAlpha=0.35;ctx.fillStyle='#6a90c0';ctx.beginPath();ctx.arc(p.x,p.y,1.4,0,Math.PI*2);ctx.fill(); }
      ctx.globalAlpha=1;
    }
  }

  function drawOrbit(ctx,W,H){
    if(issOrbit.length<2) return;
    ctx.strokeStyle='rgba(0,255,229,0.12)'; ctx.lineWidth=0.9; ctx.setLineDash([3,8]);
    let lx=null; ctx.beginPath();
    for(const [la,lo] of issOrbit){
      const p=xy(W,H,lo,la);
      if(lx===null){ctx.moveTo(p.x,p.y);lx=p.x;}
      else{if(Math.abs(p.x-lx)>W*0.45)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);lx=p.x;}
    }
    ctx.stroke(); ctx.setLineDash([]);
  }

  function drawTrail(ctx,W,H){
    if(issTrail.length<2) return;
    for(let i=1;i<issTrail.length;i++){
      const a=xy(W,H,issTrail[i-1][1],issTrail[i-1][0]);
      const b=xy(W,H,issTrail[i][1],issTrail[i][0]);
      if(Math.abs(a.x-b.x)>W*0.4) continue;
      const f=i/issTrail.length;
      ctx.strokeStyle=`rgba(0,255,229,${f*0.6})`; ctx.lineWidth=1.3;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
  }

  function drawISS(ctx,W,H,t){
    const p=xy(W,H,issLon,issLat);
    const pulse=0.5+0.5*Math.sin(t*0.0035);
    // Glow
    const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,W*0.04);
    g.addColorStop(0,'rgba(0,255,229,0.15)'); g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.fillRect(0,0,W,H);
    // Rings
    for(let r=1;r<=3;r++){
      ctx.strokeStyle=`rgba(0,255,229,${((4-r)/4)*0.12*pulse})`;
      ctx.lineWidth=0.7; ctx.beginPath(); ctx.arc(p.x,p.y,r*W*0.022,0,Math.PI*2); ctx.stroke();
    }
    // Crosshair
    const cs=W*0.018;
    ctx.shadowColor='#00ffe5'; ctx.shadowBlur=8;
    ctx.strokeStyle='rgba(0,255,229,0.85)'; ctx.lineWidth=1.1;
    ctx.beginPath();
    ctx.moveTo(p.x-cs,p.y);ctx.lineTo(p.x-cs*0.28,p.y);
    ctx.moveTo(p.x+cs*0.28,p.y);ctx.lineTo(p.x+cs,p.y);
    ctx.moveTo(p.x,p.y-cs);ctx.lineTo(p.x,p.y-cs*0.28);
    ctx.moveTo(p.x,p.y+cs*0.28);ctx.lineTo(p.x,p.y+cs);
    ctx.stroke(); ctx.shadowBlur=0;
    // Dot
    ctx.fillStyle='rgba(0,255,229,0.9)'; ctx.beginPath(); ctx.arc(p.x,p.y,2.5+pulse,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(180,255,245,0.8)'; ctx.font=`bold ${Math.max(8,W*0.009)}px Rajdhani,sans-serif`;
    ctx.fillText('ISS',p.x+8,p.y-7);
  }

  function drawMe(ctx,W,H){
    const p=xy(W,H,myLon,myLat);
    ctx.shadowColor='#ffaa00'; ctx.shadowBlur=7;
    ctx.strokeStyle='rgba(255,170,0,0.75)'; ctx.lineWidth=1.1;
    const s=W*0.012;
    ctx.beginPath(); ctx.moveTo(p.x-s,p.y);ctx.lineTo(p.x+s,p.y); ctx.moveTo(p.x,p.y-s);ctx.lineTo(p.x,p.y+s); ctx.stroke();
    ctx.shadowBlur=0;
    ctx.fillStyle='rgba(255,170,0,0.75)'; ctx.font=`${Math.max(7,W*0.008)}px Rajdhani,sans-serif`;
    ctx.fillText('YOU',p.x+6,p.y-5);
  }

  function drawLine(ctx,W,H){
    const a=xy(W,H,myLon,myLat), b=xy(W,H,issLon,issLat);
    if(Math.abs(a.x-b.x)>W*0.5) return;
    const g=ctx.createLinearGradient(a.x,a.y,b.x,b.y);
    g.addColorStop(0,'rgba(255,170,0,0.12)'); g.addColorStop(1,'rgba(0,255,229,0.06)');
    ctx.strokeStyle=g; ctx.lineWidth=0.7; ctx.setLineDash([2,7]);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    ctx.setLineDash([]);
  }

  return {drawMini,setOpts,setISS,setTrail,setOrbit,setMyLocation,getISSScreenPos};
})();

const CONTINENT_SHAPES=[
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]],
];
