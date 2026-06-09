// control.js — v3 Control panel with POV switcher, feature toggles, audio, weather, notifications

(function(){
'use strict';
const $=id=>document.getElementById(id);
let myLat=null,myLon=null,currentPOV='my_location';
let bc=null, telQ=[], lastTelFlush=0;
let mapCanvas, mapCtx, mapW, mapH;
let deferredInstall=null;

try{ bc=new BroadcastChannel('sentinel_ctrl'); }catch(e){}
function bcast(data){ try{ bc&&bc.postMessage(data); }catch(e){} }

// ── BOOT ─────────────────────────────────
function boot(){
  const lines=['bl1','bl2','bl3','bl4'];
  lines.forEach((id,i)=>setTimeout(()=>$(id).classList.add('on'),i*420+150));
  setTimeout(()=>{ $('bfill').style.width='100%'; },80);
  setTimeout(()=>{
    $('boot').classList.add('fade');
    $('app').classList.remove('hidden');
    setTimeout(()=>{ $('app').classList.add('show'); $('boot').style.display='none'; init(); },800);
  },2700);
}

function init(){
  mapCanvas=$('mini-map');
  mapCtx=mapCanvas.getContext('2d');
  function sizeMap(){ const w=mapCanvas.parentElement; mapW=mapCanvas.width=w.clientWidth; mapH=mapCanvas.height=w.clientHeight; StarField.generate(mapW,mapH,Math.floor(mapW*mapH/2400)); }
  sizeMap(); window.addEventListener('resize',sizeMap);
  StarField.generateMini(160);

  // Restore saved state
  try{
    const loc=JSON.parse(localStorage.getItem('sentinel_loc')||'null');
    if(loc){ myLat=loc.lat; myLon=loc.lon; Renderer.setMyLocation(myLat,myLon); updateLocDisplay(); }
    const pov=localStorage.getItem('sentinel_pov')||'my_location';
    currentPOV=pov;
  }catch(e){}

  buildPOVGrid();
  bindUI();
  startClock();
  startMapLoop();
  Tracker.start();
  Tracker.on('update',onUpdate);
  Tracker.on('status',onStatus);
  addTelem('System initialized. v3 multi-satellite.','init');
  addTelem('Loading satellite catalog...','new');

  // PWA install prompt
  window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); deferredInstall=e; $('btn-install').style.display='block'; $('install-note').style.display='none'; });
}

// ── POV GRID ──────────────────────────────
function buildPOVGrid(){
  const grid=$('pov-grid');
  const povOptions=[
    { id:'my_location', name:'My Location', emoji:'📍', norad:'GROUND VIEW', color:'#ffaa00' },
    { id:'global',      name:'Global View', emoji:'🌍', norad:'ALL SATS',    color:'#c084fc' },
    ...Object.entries(SATELLITE_CATALOG).map(([id,cat])=>({ id, name:cat.short, emoji:cat.emoji, norad:'NORAD '+id, color:cat.color }))
  ];
  grid.innerHTML=povOptions.map(p=>`
    <button class="pov-btn${p.id==currentPOV?' active':''}" data-pov="${p.id}" style="--sat-col:${p.color}">
      <div class="pov-active-dot" style="background:${p.color}"></div>
      <div class="pov-btn-emoji">${p.emoji}</div>
      <div class="pov-btn-name">${p.name}</div>
      <div class="pov-btn-norad">${p.norad}</div>
    </button>`).join('');
  grid.querySelectorAll('.pov-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      currentPOV=btn.dataset.pov;
      grid.querySelectorAll('.pov-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      Tracker.setPOV(currentPOV);
      localStorage.setItem('sentinel_pov',currentPOV);
      bcast({type:'pov',pov:currentPOV});
      updateHeroCard();
      addTelem(`POV switched: ${btn.querySelector('.pov-btn-name').textContent}`,'new');
    });
  });
}

// ── TRACKER ──────────────────────────────
function onUpdate(d){
  Renderer.setSatellites(d.satellites);
  updateHeroData(d.satellites);
  updatePassCard(d.satellites);
  telQ.push({ msg:`[${new Date().toUTCString().slice(17,25)}] ${Object.keys(d.satellites).length} sats tracked · ISS ${fmtCoord(d.satellites[25544]?.lat,'N','S')} ${fmtCoord(d.satellites[25544]?.lon,'E','W')}`, type:'new' });
  PassNotifications.checkPasses(d.satellites,myLat,myLon);
  if(d.satellites[25544]) AudioEngine.updateState({ altitude:d.satellites[25544].alt||408, distKm:myLat!==null?haversine(myLat,myLon,d.satellites[25544].lat,d.satellites[25544].lon):9999, overhead:false });
}

function onStatus(s){
  const dot=$('sig-dot'),lbl=$('sig-label'),api=$('api-dot'),mode=$('api-mode-label');
  if(s==='live'){ dot.className='sig-dot live'; lbl.textContent='LIVE'; api.className='api-status-dot ok'; mode&&(mode.textContent='Live data · 5s refresh'); addTelem('Live data stream active.','new'); }
  else { dot.className='sig-dot demo'; lbl.textContent='DEMO'; api.className='api-status-dot err'; mode&&(mode.textContent='Simulation mode (API unavailable)'); addTelem('API unreachable — simulation active.','warn'); }
}

function updateHeroData(sats){
  const focusId=(currentPOV==='my_location'||currentPOV==='global')?25544:parseInt(currentPOV);
  const sat=sats[focusId]; if(!sat) return;
  const cat=SATELLITE_CATALOG[focusId];
  setText('d-lat',fmtCoord(sat.lat,'N','S'));
  setText('d-lon',fmtCoord(sat.lon,'E','W'));
  setText('d-alt',sat.alt?sat.alt.toFixed(1)+' km':'—');
  setText('d-vel',sat.velocity?(sat.velocity/1000).toFixed(2)+' km/s':'—');
  setText('d-foot',sat.footprint?Math.round(sat.footprint)+' km':'—');
  setText('d-vis',(sat.visibility||'—').toUpperCase());
  const prog=Tracker.getOrbitProgressById(focusId);
  $('d-orb-fill').style.width=(prog*100)+'%';
  $('d-orb-pct').textContent=Math.round(prog*100)+'%';
}

function updateHeroCard(){
  const focusId=(currentPOV==='my_location'||currentPOV==='global')?25544:parseInt(currentPOV);
  const cat=SATELLITE_CATALOG[focusId];
  if(cat) setText('hero-norad',`NORAD ${focusId} · ${cat.name}`);
}

function updatePassCard(sats){
  if(myLat===null){ return; }
  let bestEta=Infinity,bestDist=Infinity,bestName='';
  const focusId=(currentPOV==='my_location'||currentPOV==='global')?null:parseInt(currentPOV);
  const checkIds=focusId?[focusId]:Object.keys(sats).map(Number);
  for(const id of checkIds){
    const sat=sats[id]; const cat=SATELLITE_CATALOG[id];
    if(!sat||!cat) continue;
    const dist=haversine(myLat,myLon,sat.lat,sat.lon);
    if(dist<bestDist){ bestDist=dist; bestName=cat.short; }
  }
  const passes=Tracker.getPassETA(myLat,myLon);
  let etaMin=999;
  for(const p of Object.values(passes)){ if(p.etaMin<etaMin) etaMin=p.etaMin; }
  if(bestDist<900){ $('p-eta').textContent='⚡ NOW'; $('p-eta').style.color='var(--iss)'; }
  else{
    const h=Math.floor(etaMin/60),m=etaMin%60;
    $('p-eta').textContent=h>0?`${h}h ${m}m`:`~${m} min`;
    $('p-eta').style.color='';
  }
  $('p-sub').textContent=`${bestName} closest`;
  $('p-dist').textContent=`Distance: ${Math.round(bestDist).toLocaleString()} km`;
}

// ── MAP LOOP ──────────────────────────────
let t0=performance.now();
function startMapLoop(){
  function loop(now){ Renderer.drawMini(mapCtx,mapW,mapH,now-t0); flushTelem(); requestAnimationFrame(loop); }
  requestAnimationFrame(loop);
}

// ── CLOCK ─────────────────────────────────
function startClock(){
  function tick(){ $('utc-clock').textContent=new Date().toUTCString().slice(17,25); }
  tick(); setInterval(tick,1000);
}

// ── TELEM ─────────────────────────────────
function addTelem(msg,type){ telQ.push({msg,type:type||''}); }
function flushTelem(){
  if(!telQ.length||performance.now()-lastTelFlush<1200) return;
  lastTelFlush=performance.now();
  const s=$('telem-stream'),item=telQ.shift();
  const d=document.createElement('div');
  d.className='tl '+item.type; d.textContent=item.msg;
  s.appendChild(d);
  while(s.children.length>50) s.removeChild(s.firstChild);
  s.scrollTop=s.scrollHeight;
}

// ── UI BINDINGS ───────────────────────────
function bindUI(){
  // Location
  $('btn-locate').addEventListener('click',()=>{
    if(!navigator.geolocation){ showLocErr('Geolocation not supported.'); return; }
    $('btn-locate').textContent='⟳ ACQUIRING...'; $('btn-locate').disabled=true;
    navigator.geolocation.getCurrentPosition(pos=>{
      myLat=pos.coords.latitude; myLon=pos.coords.longitude;
      localStorage.setItem('sentinel_loc',JSON.stringify({lat:myLat,lon:myLon}));
      Renderer.setMyLocation(myLat,myLon); Tracker.setLocation(myLat,myLon);
      updateLocDisplay();
      $('btn-locate').textContent='✓ ACQUIRED'; $('btn-locate').disabled=false;
      bcast({type:'location',lat:myLat,lon:myLon,weatherEnabled:WeatherLayer.isEnabled()});
      if(WeatherLayer.isEnabled()) WeatherLayer.enable(myLat,myLon);
      addTelem(`Location: ${fmtCoord(myLat,'N','S')} ${fmtCoord(myLon,'E','W')}`,'new');
    },()=>{ $('btn-locate').textContent='⊕ ACQUIRE LOCATION'; $('btn-locate').disabled=false; showLocErr('Permission denied.'); });
  });

  // Feature toggles
  $('tog-audio').addEventListener('change',e=>{
    e.target.checked?AudioEngine.enable():AudioEngine.disable();
    bcast({type:'audio',enabled:e.target.checked});
    addTelem('Ambient audio '+(e.target.checked?'enabled':'disabled')+'.',e.target.checked?'new':'warn');
  });
  $('tog-notify').addEventListener('change',e=>{
    if(e.target.checked){ PassNotifications.enable(); PassNotifications.requestPermission().then(ok=>{ if(!ok){ e.target.checked=false; showLocErr('Notification permission denied.'); } }); }
    else PassNotifications.disable();
    bcast({type:'notify',enabled:e.target.checked});
    addTelem('Pass notifications '+(e.target.checked?'enabled':'disabled')+'.',e.target.checked?'new':'warn');
  });
  $('tog-weather').addEventListener('change',e=>{
    if(e.target.checked){ WeatherLayer.enable(myLat,myLon); }else{ WeatherLayer.disable(); }
    bcast({type:'weather',enabled:e.target.checked});
    addTelem('Cloud cover layer '+(e.target.checked?'enabled':'disabled')+'.',e.target.checked?'new':'warn');
  });

  // View layers
  function bindTog(id,key){ $(id).addEventListener('change',e=>{ const o={}; o[key]=e.target.checked; Renderer.setOpts(o); bcast({type:'opts',opts:o}); }); }
  bindTog('t-stars','stars'); bindTog('t-const','constellations'); bindTog('t-grid','grid'); bindTog('t-term','terminator'); bindTog('t-orbit','orbitPath');

  // Brightness
  $('sl-bright').addEventListener('input',e=>{ $('sl-bright-val').textContent=e.target.value+'%'; bcast({type:'brightness',value:e.target.value/100}); });

  // Ceiling
  $('btn-ceiling').addEventListener('click',()=>{ window.open('view.html','sentinel_view'); setTimeout(()=>bcast({type:'ceiling',enabled:true}),500); });

  // PWA install
  $('btn-install').addEventListener('click',()=>{ if(deferredInstall){ deferredInstall.prompt(); deferredInstall.userChoice.then(()=>{ deferredInstall=null; $('btn-install').style.display='none'; }); } });

  // Map tooltip
  mapCanvas.addEventListener('mousemove',e=>{
    const r=mapCanvas.getBoundingClientRect();
    const mx=e.clientX-r.left,my_=e.clientY-r.top;
    const sats=Tracker.getSatellites();
    let found=null,minD=999;
    for(const [id,sat] of Object.entries(sats)){
      if(!sat.lat&&sat.lat!==0) continue;
      const px=((sat.lon+180)/360)*mapW, py=((90-sat.lat)/180)*mapH;
      const d=Math.hypot(mx-px,my_-py);
      if(d<20&&d<minD){ minD=d; found={id:parseInt(id),sat,px,py}; }
    }
    const tip=$('map-tip');
    if(found){ const cat=SATELLITE_CATALOG[found.id]; tip.innerHTML=`<b>${cat?.name||'SAT'}</b><br>Lat ${fmtCoord(found.sat.lat,'N','S')} Lon ${fmtCoord(found.sat.lon,'E','W')}<br>Alt ${found.sat.alt?.toFixed(0)||'—'} km`; tip.style.left=(found.px+12)+'px'; tip.style.top=(found.py-8)+'px'; tip.classList.remove('hidden'); }
    else tip.classList.add('hidden');
  });
  mapCanvas.addEventListener('mouseleave',()=>$('map-tip').classList.add('hidden'));
}

function updateLocDisplay(){
  const el=$('loc-info');
  el.className='loc-set';
  el.innerHTML=`<div class="lc-coord">${fmtCoord(myLat,'N','S')}, ${fmtCoord(myLon,'E','W')}</div><div class="lc-sub">Browser GPS · stored locally</div>`;
}
function showLocErr(msg){ const e=$('loc-err'); e.textContent=msg; e.classList.remove('hidden'); setTimeout(()=>e.classList.add('hidden'),4000); }
function setText(id,v){ const el=$(id); if(el) el.textContent=v; }
function fmtCoord(v,p,n){ if(v===undefined||v===null) return '—'; return Math.abs(v).toFixed(3)+'° '+(v>=0?p:n); }
function haversine(a,b,c,d){ const R=6371,dL=(c-a)*Math.PI/180,dG=(d-b)*Math.PI/180; const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dG/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); }

document.addEventListener('DOMContentLoaded',boot);
})();
