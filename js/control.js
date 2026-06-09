// control.js — Control panel orchestrator

(function(){
'use strict';

const $ = id => document.getElementById(id);
let myLat=null, myLon=null;
let bc=null;
let telQ=[], lastTelFlush=0;
let mapCanvas, mapCtx, mapW, mapH;

// ── BroadcastChannel to talk to view.html ──
try{ bc = new BroadcastChannel('sentinel_ctrl'); }catch(e){}
function broadcast(data){ try{ bc && bc.postMessage(data); }catch(e){} }

// ── BOOT ──────────────────────────────────
function boot(){
  const lines=['bl1','bl2','bl3','bl4'], fill=$('bfill');
  lines.forEach((id,i)=>setTimeout(()=>$(id).classList.add('on'), i*420+150));
  setTimeout(()=>{ fill.style.width='100%'; },100);
  setTimeout(()=>{
    $('boot').classList.add('fade');
    $('app').classList.remove('hidden');
    setTimeout(()=>{ $('app').classList.add('show'); $('boot').style.display='none'; init(); }, 800);
  }, 2700);
}

// ── INIT ──────────────────────────────────
function init(){
  mapCanvas = $('mini-map');
  mapCtx = mapCanvas.getContext('2d');

  // Size mini map
  function sizeMap(){
    const wrap = mapCanvas.parentElement;
    mapW = mapCanvas.width = wrap.clientWidth;
    mapH = mapCanvas.height = wrap.clientHeight;
    StarField.generate(mapW, mapH, Math.floor(mapW*mapH/2200));
  }
  sizeMap();
  window.addEventListener('resize', sizeMap);

  StarField.generateMini(160);

  // Load saved location
  try{
    const s = JSON.parse(localStorage.getItem('sentinel_loc')||'null');
    if(s){ myLat=s.lat; myLon=s.lon; updateLocDisplay(); }
  }catch(e){}

  bindUI();
  startClock();
  startMapLoop();
  Tracker.start();
  Tracker.on('update', onUpdate);
  Tracker.on('status', onStatus);
  addTelem('System initialized.','init');
  addTelem('Connecting to NORAD data stream...','new');
}

// ── TRACKER UPDATES ───────────────────────
function onUpdate(d){
  Renderer.setISS(d.latitude, d.longitude);
  Renderer.setTrail(d.trail);
  Renderer.setOrbit(d.orbit);

  setText('d-lat', fmtCoord(d.latitude,'N','S'));
  setText('d-lon', fmtCoord(d.longitude,'E','W'));
  setText('d-alt', d.altitude.toFixed(1)+' km');
  setText('d-vel', (d.velocity/1000).toFixed(2)+' km/s');
  setText('d-foot', Math.round(d.footprint)+' km');
  setText('d-vis', (d.visibility||'unknown').toUpperCase());

  const prog = Tracker.getOrbitProgress();
  $('d-orb-fill').style.width = (prog*100)+'%';
  $('d-orb-pct').textContent = Math.round(prog*100)+'%';

  if(myLat!==null){
    const pass = Tracker.getPassETA(myLat,myLon);
    if(pass){
      const dist = haversine(myLat,myLon,d.latitude,d.longitude);
      if(dist<900){
        $('p-eta').textContent='⚡ NOW';
        $('p-eta').style.color='var(--glow-iss)';
      } else {
        const h=Math.floor(pass.etaMin/60), m=pass.etaMin%60;
        $('p-eta').textContent = h>0 ? `${h}h ${m}m` : `~${m} min`;
        $('p-eta').style.color='';
      }
      $('p-sub').textContent='Estimated closest approach';
      $('p-dist').textContent='Current distance: '+Math.round(haversine(myLat,myLon,d.latitude,d.longitude)).toLocaleString()+' km';
    }
  }

  telQ.push({
    msg:`[${new Date().toUTCString().slice(17,25)}] LAT ${fmtCoord(d.latitude,'N','S')} LON ${fmtCoord(d.longitude,'E','W')} ALT ${d.altitude.toFixed(0)}km`,
    type:'new'
  });
}

function onStatus(s){
  const dot=$('sig-dot'), lbl=$('sig-label'), api=$('api-dot'), mode=$('api-mode');
  if(s==='live'){
    dot.className='sig-dot live'; lbl.textContent='LIVE';
    api.className='api-status-dot ok'; mode.textContent='live';
    addTelem('Live data stream established.','new');
  } else {
    dot.className='sig-dot demo'; lbl.textContent='DEMO MODE';
    api.className='api-status-dot err'; mode.textContent='demo/simulation';
    addTelem('API unreachable — simulation active.','warn');
  }
}

// ── MAP LOOP ──────────────────────────────
let t0=performance.now();
function startMapLoop(){
  function loop(now){
    const t=now-t0;
    // Draw mini map
    Renderer.drawMini(mapCtx, mapW, mapH, t);
    flushTelem();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// ── CLOCK ─────────────────────────────────
function startClock(){
  function tick(){
    const n=new Date();
    $('utc-clock').textContent=[n.getUTCHours(),n.getUTCMinutes(),n.getUTCSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
  }
  tick(); setInterval(tick,1000);
}

// ── TELEMETRY ─────────────────────────────
function addTelem(msg,type){
  telQ.push({msg,type:type||''});
}
function flushTelem(){
  if(!telQ.length || performance.now()-lastTelFlush < 1200) return;
  lastTelFlush=performance.now();
  const s=$('telem-stream'), item=telQ.shift();
  const d=document.createElement('div');
  d.className='tl '+item.type;
  d.textContent=item.msg;
  s.appendChild(d);
  while(s.children.length>50) s.removeChild(s.firstChild);
  s.scrollTop=s.scrollHeight;
}

// ── UI BINDINGS ───────────────────────────
function bindUI(){
  $('btn-locate').addEventListener('click',()=>{
    if(!navigator.geolocation){ showLocErr('Geolocation not supported.'); return; }
    $('btn-locate').textContent='⟳ ACQUIRING...';
    $('btn-locate').disabled=true;
    navigator.geolocation.getCurrentPosition(pos=>{
      myLat=pos.coords.latitude; myLon=pos.coords.longitude;
      localStorage.setItem('sentinel_loc', JSON.stringify({lat:myLat,lon:myLon}));
      Renderer.setMyLocation(myLat,myLon);
      updateLocDisplay();
      $('btn-locate').textContent='✓ LOCATION ACQUIRED';
      $('btn-locate').disabled=false;
      broadcast({type:'location',lat:myLat,lon:myLon});
      addTelem(`Location acquired: ${fmtCoord(myLat,'N','S')} ${fmtCoord(myLon,'E','W')}`, 'new');
    }, err=>{
      $('btn-locate').textContent='⊕ ACQUIRE LOCATION';
      $('btn-locate').disabled=false;
      showLocErr('Permission denied or unavailable.');
    });
  });

  // Toggles — broadcast to view
  function bindToggle(id, key){
    $(id).addEventListener('change', e=>{
      const opts={}; opts[key]=e.target.checked;
      Renderer.setOpts(opts);
      broadcast({type:'opts',opts});
    });
  }
  bindToggle('t-stars','stars');
  bindToggle('t-const','constellations');
  bindToggle('t-grid','grid');
  bindToggle('t-term','terminator');
  bindToggle('t-orbit','orbitPath');

  // Brightness
  $('sl-bright').addEventListener('input',e=>{
    const v=e.target.value;
    $('sl-bright-val').textContent=v+'%';
    broadcast({type:'brightness',value:v/100});
  });

  // Star density
  $('sl-stars').addEventListener('input',e=>{
    $('sl-stars-val').textContent=e.target.value;
  });

  // Ceiling mode — opens view in new tab flipped
  $('btn-ceiling').addEventListener('click',()=>{
    const w=window.open('view.html','sentinel_view');
    if(w) broadcast({type:'ceiling',enabled:true});
  });

  // Map tooltip
  mapCanvas.addEventListener('mousemove', e=>{
    const r=mapCanvas.getBoundingClientRect();
    const mx=e.clientX-r.left, my=e.clientY-r.top;
    const p=Renderer.getISSScreenPos(mapW,mapH);
    if(!p) return;
    const dx=mx-p.x, dy=my-p.y;
    if(Math.sqrt(dx*dx+dy*dy)<20){
      const d=Tracker.getData();
      const tip=$('map-tip');
      tip.innerHTML=`<b>ISS — ZARYA</b><br>Lat: ${fmtCoord(d.latitude,'N','S')} Lon: ${fmtCoord(d.longitude,'E','W')}<br>Alt: ${d.altitude.toFixed(1)} km · Vel: ${(d.velocity/1000).toFixed(2)} km/s`;
      tip.style.left=(p.x+12)+'px'; tip.style.top=(p.y-8)+'px';
      tip.classList.remove('hidden');
    } else {
      $('map-tip').classList.add('hidden');
    }
  });
  mapCanvas.addEventListener('mouseleave',()=>$('map-tip').classList.add('hidden'));
}

function updateLocDisplay(){
  const el=$('loc-info');
  el.className='loc-set';
  el.innerHTML=`<div class="lc-coord">${fmtCoord(myLat,'N','S')}, ${fmtCoord(myLon,'E','W')}</div><div class="lc-sub">Browser GPS · stored locally</div>`;
  $('p-sub').textContent='Calculating next pass...';
}
function showLocErr(msg){ const e=$('loc-err'); e.textContent=msg; e.classList.remove('hidden'); setTimeout(()=>e.classList.add('hidden'),4000); }

function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
function fmtCoord(v,p,n){ return Math.abs(v).toFixed(3)+'° '+(v>=0?p:n); }
function haversine(a,b,c,d){ const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180; const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }

document.addEventListener('DOMContentLoaded', boot);
})();
