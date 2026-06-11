/**
 * control.js — Control panel orchestrator (v5)
 * Adds: mode switcher with Demo toggle, source status panel,
 * TLE health table, N2YO key input, observability grid.
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  let myLat=null, myLon=null, currentPOV='my_location';
  let bc=null, telQ=[], lastTelFlush=0;
  let mapCanvas, mapCtx, mapW, mapH;
  let t0 = performance.now();
  let deferredInstall = null;

  try { bc = new BroadcastChannel('sentinel_ctrl'); } catch(e){}
  function bcast(d) { try { bc && bc.postMessage(d); } catch(e){} }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    ['bl1','bl2','bl3','bl4'].forEach((id,i) => setTimeout(() => $(id)?.classList.add('on'), i*420+150));
    setTimeout(() => { const f=$('bfill'); if(f) f.style.width='100%'; }, 80);
    setTimeout(() => {
      $('boot')?.classList.add('fade');
      $('app')?.classList.remove('hidden');
      setTimeout(() => { $('app')?.classList.add('show'); $('boot').style.display='none'; init(); }, 800);
    }, 2700);
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    mapCanvas = $('mini-map');
    mapCtx = mapCanvas.getContext('2d');
    function sizeMap() {
      const w = mapCanvas.parentElement;
      mapW = mapCanvas.width  = w.clientWidth;
      mapH = mapCanvas.height = w.clientHeight;
      StarField.generate(mapW, mapH, Math.floor(mapW*mapH/2400));
    }
    sizeMap();
    window.addEventListener('resize', sizeMap);
    StarField.generateMini(160);

    // Restore saved state
    try {
      const loc = JSON.parse(localStorage.getItem('sentinel_loc') || 'null');
      if (loc) { myLat=loc.lat; myLon=loc.lon; Renderer.setMyLocation(myLat,myLon); updateLocDisplay(); }
      currentPOV = localStorage.getItem('sentinel_pov') || 'my_location';
    } catch(e) {}

    buildPOVGrid();
    bindUI();
    startClock();
    startMapLoop();

    // Start with live mode (pre-warm TLEs in background)
    const savedMode = localStorage.getItem('sentinel_mode') || 'live';
    Tracker.start();  // starts in live by default
    if (savedMode !== 'live') {
      Tracker.setMode(savedMode);
      updateModeUI(savedMode);
    }

    Tracker.on('update',       onUpdate);
    Tracker.on('status',       onStatus);
    Tracker.on('mode_changed', d => updateModeUI(d.mode));

    addTelem('System initialized. v5 multi-source live tracking.', 'init');
    addTelem('Pre-warming TLE cache from CelesTrak…', 'new');

    // PWA
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); deferredInstall = e;
      const b = $('btn-install'); if(b) { b.style.display='block'; }
      const n = $('install-note'); if(n) n.style.display='none';
    });
  }

  // ── POV grid ─────────────────────────────────────────────────────────────
  function buildPOVGrid() {
    const grid = $('pov-grid'); if(!grid) return;
    const povOptions = [
      { id:'my_location', name:'My Location', emoji:'📍', norad:'GROUND VIEW', color:'#ffaa00' },
      { id:'global',      name:'Global View', emoji:'🌍', norad:'ALL SATS',    color:'#c084fc' },
      ...Object.entries(SATELLITE_CATALOG).map(([id,cat]) => ({ id, name:cat.short, emoji:cat.emoji, norad:'NORAD '+id, color:cat.color }))
    ];
    grid.innerHTML = povOptions.map(p => `
      <button class="pov-btn${p.id==currentPOV?' active':''}" data-pov="${p.id}" style="--sat-col:${p.color}">
        <div class="pov-active-dot" style="background:${p.color}"></div>
        <div class="pov-btn-emoji">${p.emoji}</div>
        <div class="pov-btn-name">${p.name}</div>
        <div class="pov-btn-norad">${p.norad}</div>
      </button>`).join('');
    grid.querySelectorAll('.pov-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentPOV = btn.dataset.pov;
        grid.querySelectorAll('.pov-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Tracker.setPOV(currentPOV);
        localStorage.setItem('sentinel_pov', currentPOV);
        bcast({ type:'pov', pov:currentPOV });
        updateHeroCard();
        addTelem('POV: '+btn.querySelector('.pov-btn-name').textContent, 'new');
      });
    });
  }

  // ── Tracker events ────────────────────────────────────────────────────────
  function onUpdate(d) {
    Renderer.setSatellites(d.satellites);
    updateHeroData(d.satellites);
    updatePassCard(d.satellites);
    updateSourcePanel(d);
    if (Tracker.getMode() === 'calculated') updateObsPanel(d.satellites);
    if (Tracker.getMode() === 'calculated') updateTLEPanel();

    const onlineCount = Object.values(d.satellites).filter(s => !s.offline && s.lat!==undefined).length;
    addTelem(
      `[${new Date().toUTCString().slice(17,25)}] ${onlineCount}/${Object.keys(SATELLITE_CATALOG).length} sats online` +
      (d.mode === 'demo' ? ' [DEMO]' : d.liveCount > 0 ? ` · ${d.liveCount} live` : ''),
      'new'
    );
    PassNotifications.checkPasses(d.satellites, myLat, myLon);
    if (d.satellites[25544]) {
      AudioEngine.updateState({
        altitude: d.satellites[25544].alt || 408,
        distKm: myLat!==null ? Tracker.haversine(myLat,myLon,d.satellites[25544].lat||0,d.satellites[25544].lon||0) : 9999,
        overhead: false,
      });
    }
  }

  function onStatus(s) {
    const dot=$('sig-dot'), lbl=$('sig-label'), api=$('api-dot'), mode=$('api-mode-label');
    const states = {
      live:              { dotClass:'live',      label:'LIVE',        apiClass:'ok',  modeText:'Live API · multi-source' },
      calculated:        { dotClass:'live',      label:'CALCULATED',  apiClass:'ok',  modeText:'SGP4 · CelesTrak TLE' },
      demo:              { dotClass:'demo',      label:'DEMO',        apiClass:'err', modeText:'Simulation — not real data' },
      acquiring:         { dotClass:'',          label:'ACQUIRING',   apiClass:'',    modeText:'Connecting…' },
      data_unavailable:  { dotClass:'error',     label:'NO DATA',     apiClass:'err', modeText:'All API sources failed' },
      tle_unavailable:   { dotClass:'error',     label:'NO TLE',      apiClass:'err', modeText:'CelesTrak unreachable' },
    };
    const st = states[s] || states.acquiring;
    if (dot)  dot.className  = 'sig-dot ' + st.dotClass;
    if (lbl)  lbl.textContent = st.label;
    if (api)  api.className  = 'api-status-dot ' + st.apiClass;
    if (mode) mode.textContent = st.modeText;
  }

  function updateHeroData(sats) {
    const focusId = (currentPOV==='my_location'||currentPOV==='global') ? 25544 : parseInt(currentPOV);
    const sat = sats[focusId]; if(!sat) return;
    const cat = SATELLITE_CATALOG[focusId];
    if(sat.offline){ setText('d-lat','OFFLINE'); setText('d-lon','—'); return; }
    setText('d-lat', fmtCoord(sat.lat,'N','S'));
    setText('d-lon', fmtCoord(sat.lon,'E','W'));
    setText('d-alt', sat.alt ? sat.alt.toFixed(1)+' km' : '—');
    setText('d-vel', sat.velocity ? (sat.velocity/1000).toFixed(2)+' km/s' : '—');
    setText('d-foot', sat.footprint ? Math.round(sat.footprint)+' km' : '—');
    setText('d-vis', (sat.visibility||'—').toUpperCase());
    if(cat){
      const p=Tracker.getOrbitProgressById(focusId);
      const fill=$('d-orb-fill'), pct=$('d-orb-pct');
      if(fill) fill.style.width=(p*100)+'%';
      if(pct)  pct.textContent=Math.round(p*100)+'%';
    }
    // TLE age badge
    const tleBadge=$('tle-age-badge');
    if(tleBadge && sat.tleAgeDays!==undefined){
      tleBadge.textContent = `TLE: ${parseFloat(sat.tleAgeDays).toFixed(1)}d old`;
      tleBadge.className = 'tle-badge '+(sat.tleAgeDays<2?'fresh':sat.tleAgeDays<7?'good':sat.tleAgeDays<14?'aging':'expired');
    }
    // Source badge
    const srcBadge=$('source-badge');
    if(srcBadge){
      const src = sat.source || (sat.demo?'demo':sat.liveData===false?'sgp4':'api');
      srcBadge.textContent = src.toUpperCase().replace('_',' ');
    }
  }

  function updateHeroCard() {
    const focusId = (currentPOV==='my_location'||currentPOV==='global') ? 25544 : parseInt(currentPOV);
    const cat = SATELLITE_CATALOG[focusId];
    if(cat) setText('hero-norad', `NORAD ${focusId} · ${cat.name}`);
  }

  function updatePassCard(sats) {
    if(myLat===null) return;
    let bestDist=Infinity, bestName='';
    const focusId = (currentPOV==='my_location'||currentPOV==='global') ? null : parseInt(currentPOV);
    const checkIds = focusId ? [focusId] : Object.keys(sats).map(Number);
    for(const id of checkIds){
      const sat=sats[id]; const cat=SATELLITE_CATALOG[id];
      if(!sat||!cat||sat.offline||sat.lat===undefined) continue;
      const dist=Tracker.haversine(myLat,myLon,sat.lat,sat.lon);
      if(dist<bestDist){bestDist=dist;bestName=cat.short;}
    }
    const pEta=$('p-eta'), pSub=$('p-sub'), pDist=$('p-dist');
    if(bestDist<900){if(pEta){pEta.textContent='⚡ NOW';pEta.style.color='var(--iss)';}}
    else {
      const passes=Tracker.getPassETA();
      let etaMin=999;
      for(const p of Object.values(passes)){if(p.etaMin!==null&&p.etaMin<etaMin)etaMin=p.etaMin;}
      const h=Math.floor(etaMin/60),m=etaMin%60;
      if(pEta){pEta.textContent=etaMin<999?(h>0?`${h}h ${m}m`:`~${m} min`):'—';pEta.style.color='';}
    }
    if(pSub)  pSub.textContent  = bestName ? `${bestName} closest approach` : 'Enable location for passes';
    if(pDist) pDist.textContent = bestDist<Infinity ? `Distance: ${Math.round(bestDist).toLocaleString()} km` : '';
  }

  // ── Source status panel ───────────────────────────────────────────────────
  function updateSourcePanel(d) {
    const panel = $('source-status-panel'); if(!panel) return;
    const statuses = ApiLayer.getSourceStatus();
    const sats = d.satellites;
    const rows = Object.entries(SATELLITE_CATALOG).map(([id, cat]) => {
      const sat = sats[id];
      const st  = statuses[id];
      const src = sat?.source || (sat?.demo?'demo':sat?.liveData===false?'sgp4':'—');
      const online = sat && !sat.offline && sat.lat!==undefined;
      const ageStr = sat?.tleAgeDays !== undefined ? sat.tleAgeDays.toFixed(1)+'d' : '—';
      return `<div class="src-row">
        <span class="src-dot" style="background:${online?cat.color:'rgba(80,80,100,0.4)'}"></span>
        <span class="src-name">${cat.emoji} ${cat.short}</span>
        <span class="src-source">${src.toUpperCase().replace('_',' ')}</span>
        <span class="src-age ${sat?.tleAgeDays<2?'fresh':sat?.tleAgeDays<7?'good':sat?.tleAgeDays<14?'aging':'expired'}">${ageStr}</span>
        <span class="src-status ${online?'ok':'fail'}">${online?'●LIVE':'○OFF'}</span>
      </div>`;
    }).join('');
    panel.innerHTML = rows;
  }

  // ── Observability panel ───────────────────────────────────────────────────
  function updateObsPanel(sats) {
    const grid=$('obs-grid'); if(!grid) return;
    grid.innerHTML = Object.entries(SATELLITE_CATALOG).map(([id, cat]) => {
      const sat=sats[id];
      const obs=sat?.observability || PassNotifications.getConditions(parseInt(id));
      const p=(ok,lbl)=>`<span class="obs-pill ${ok===true?'ok':ok===false?'fail':'na'}">${lbl}</span>`;
      const el=obs?.elevation!=null?obs.elevation.toFixed(1)+'°':'—';
      return `<div class="obs-row">
        <span class="obs-emoji">${cat.emoji}</span>
        <span class="obs-sat-name">${cat.short}</span>
        <div class="obs-conditions">
          ${p(obs?.aboveHorizon,'EL>15°')}
          ${p(obs?.groundDark,'DARK')}
          ${p(obs?.illuminated,'LIT')}
          ${p(obs?.visible,obs?.visible?'VISIBLE':'—')}
        </div>
        <span class="obs-angle">${el}</span>
      </div>`;
    }).join('');
  }

  // ── TLE health panel ──────────────────────────────────────────────────────
  function updateTLEPanel() {
    const panel=$('tle-panel'); if(!panel) return;
    const tleStatus = Tracker.getTLEStatus();
    panel.innerHTML = Object.entries(SATELLITE_CATALOG).map(([id,cat]) => {
      const s=tleStatus[id];
      if(!s) return `<div class="tle-row"><span>${cat.emoji} ${cat.short}</span><span class="tle-badge expired">NO TLE</span></div>`;
      const cls=s.fresh?'fresh':s.stale?'aging':s.expired?'expired':'good';
      return `<div class="tle-row">
        <span>${cat.emoji} ${cat.short}</span>
        <span class="tle-badge ${cls}">${s.ok?s.ageDays+'d old':'EXPIRED'}</span>
      </div>`;
    }).join('');
  }

  // ── Map loop ──────────────────────────────────────────────────────────────
  function startMapLoop() {
    function loop(now) { Renderer.drawMini(mapCtx,mapW,mapH,now-t0); flushTelem(); requestAnimationFrame(loop); }
    requestAnimationFrame(loop);
  }

  // ── Clock ─────────────────────────────────────────────────────────────────
  function startClock() {
    function tick() { const el=$('utc-clock'); if(el) el.textContent=new Date().toUTCString().slice(17,25); }
    tick(); setInterval(tick,1000);
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────
  function addTelem(msg, type) { telQ.push({ msg, type: type||'' }); }
  function flushTelem() {
    if(!telQ.length||performance.now()-lastTelFlush<1200) return;
    lastTelFlush=performance.now();
    const s=$('telem-stream'), item=telQ.shift(); if(!s) return;
    const d=document.createElement('div'); d.className='tl '+item.type; d.textContent=item.msg;
    s.appendChild(d);
    while(s.children.length>60) s.removeChild(s.firstChild);
    s.scrollTop=s.scrollHeight;
  }

  // ── UI bindings ───────────────────────────────────────────────────────────
  function bindUI() {
    // Location
    $('btn-locate')?.addEventListener('click', () => {
      if(!navigator.geolocation){ showLocErr('Geolocation not supported.'); return; }
      $('btn-locate').textContent='⟳ ACQUIRING…'; $('btn-locate').disabled=true;
      navigator.geolocation.getCurrentPosition(pos => {
        myLat=pos.coords.latitude; myLon=pos.coords.longitude;
        localStorage.setItem('sentinel_loc', JSON.stringify({lat:myLat,lon:myLon}));
        Renderer.setMyLocation(myLat,myLon); Tracker.setLocation(myLat,myLon);
        updateLocDisplay();
        $('btn-locate').textContent='✓ ACQUIRED'; $('btn-locate').disabled=false;
        bcast({type:'location',lat:myLat,lon:myLon,weatherEnabled:WeatherLayer.isEnabled()});
        if(WeatherLayer.isEnabled()) WeatherLayer.enable(myLat,myLon);
        addTelem(`Location acquired: ${fmtCoord(myLat,'N','S')} ${fmtCoord(myLon,'E','W')}`, 'new');
      }, () => {
        $('btn-locate').textContent='⊕ ACQUIRE LOCATION'; $('btn-locate').disabled=false;
        showLocErr('Permission denied.');
      });
    });

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.mode;
        Tracker.setMode(m);
        updateModeUI(m);
        localStorage.setItem('sentinel_mode', m);
        bcast({type:'mode', mode:m});
        addTelem('Mode: '+m.toUpperCase(), 'new');
      });
    });

    // N2YO key
    $('n2yo-key-input')?.addEventListener('change', e => {
      const key = e.target.value.trim();
      ApiLayer.setN2YOKey(key || null);
      addTelem(key ? 'N2YO API key configured.' : 'N2YO key cleared.', 'new');
    });

    // Features
    $('tog-audio')?.addEventListener('change', e => {
      e.target.checked ? AudioEngine.enable() : AudioEngine.disable();
      bcast({type:'audio',enabled:e.target.checked});
    });
    $('tog-notify')?.addEventListener('change', e => {
      if(e.target.checked){ PassNotifications.enable(); PassNotifications.requestPermission().then(ok=>{ if(!ok){e.target.checked=false;showLocErr('Notification permission denied.');} }); }
      else PassNotifications.disable();
      bcast({type:'notify',enabled:e.target.checked});
    });
    $('tog-weather')?.addEventListener('change', e => {
      e.target.checked ? WeatherLayer.enable(myLat,myLon) : WeatherLayer.disable();
      bcast({type:'weather',enabled:e.target.checked});
    });

    // View layers
    [['t-stars','stars'],['t-const','constellations'],['t-grid','grid'],['t-term','terminator'],['t-orbit','orbitPath']].forEach(([id,key]) => {
      $(id)?.addEventListener('change', e => { const o={}; o[key]=e.target.checked; Renderer.setOpts(o); bcast({type:'opts',opts:o}); });
    });

    // Brightness
    $('sl-bright')?.addEventListener('input', e => {
      const v=e.target.value;
      const el=$('sl-bright-val'); if(el) el.textContent=v+'%';
      bcast({type:'brightness',value:v/100});
    });

    // Ceiling / fullscreen
    $('btn-ceiling')?.addEventListener('click', () => { window.open('view.html','sentinel_view'); setTimeout(()=>bcast({type:'ceiling',enabled:true}),500); });

    // PWA install
    $('btn-install')?.addEventListener('click', () => {
      if(deferredInstall){ deferredInstall.prompt(); deferredInstall.userChoice.then(()=>{ deferredInstall=null; const b=$('btn-install'); if(b) b.style.display='none'; }); }
    });

    // Map tooltip
    mapCanvas?.addEventListener('mousemove', e => {
      const r=mapCanvas.getBoundingClientRect(), mx=e.clientX-r.left, my_=e.clientY-r.top;
      const sats=Tracker.getSatellites();
      let found=null, minD=999;
      for(const [id,sat] of Object.entries(sats)){
        if(sat.offline||sat.lat===undefined) continue;
        const px=((sat.lon+180)/360)*mapW, py=((90-sat.lat)/180)*mapH;
        const d=Math.hypot(mx-px,my_-py);
        if(d<20&&d<minD){minD=d;found={id:parseInt(id),sat,px,py};}
      }
      const tip=$('map-tip');
      if(tip && found){
        const cat=SATELLITE_CATALOG[found.id];
        tip.innerHTML=`<b>${cat?.name||'SAT'}</b><br>Lat ${fmtCoord(found.sat.lat,'N','S')} Lon ${fmtCoord(found.sat.lon,'E','W')}<br>Alt ${found.sat.alt?.toFixed(0)||'—'} km · Src: ${(found.sat.source||'sgp4').toUpperCase()}`;
        tip.style.left=(found.px+12)+'px'; tip.style.top=(found.py-8)+'px'; tip.classList.remove('hidden');
      } else { tip?.classList.add('hidden'); }
    });
    mapCanvas?.addEventListener('mouseleave', () => $('map-tip')?.classList.add('hidden'));
  }

  // ── Mode UI update ────────────────────────────────────────────────────────
  window.updateModeUI = function(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.mode === mode);
      b.classList.toggle('amber-mode', b.dataset.mode === mode && mode === 'calculated');
      b.classList.toggle('red-mode',   b.dataset.mode === mode && mode === 'demo');
    });
    const obsPanel=$('obs-panel');    if(obsPanel)   obsPanel.classList.toggle('hidden',   mode!=='calculated');
    const tlePanel=$('tle-health');   if(tlePanel)   tlePanel.classList.toggle('hidden',   mode!=='calculated');
    const n2yoPanel=$('n2yo-panel');  if(n2yoPanel)  n2yoPanel.classList.toggle('hidden',  mode==='demo');
    const srcPanel=$('src-panel');    if(srcPanel)   srcPanel.style.display='block';
    const demoWarn=$('demo-warning'); if(demoWarn)   demoWarn.classList.toggle('hidden',   mode!=='demo');
  };

  function updateLocDisplay() {
    const el=$('loc-info'); if(!el) return;
    el.className='loc-set';
    el.innerHTML=`<div class="lc-coord">${fmtCoord(myLat,'N','S')}, ${fmtCoord(myLon,'E','W')}</div><div class="lc-sub">Browser GPS · stored locally</div>`;
    $('p-sub').textContent='Calculating…';
  }
  function showLocErr(msg) {
    const e=$('loc-err'); if(!e) return; e.textContent=msg; e.classList.remove('hidden'); setTimeout(()=>e.classList.add('hidden'),4000);
  }
  function setText(id,v) { const el=$(id); if(el) el.textContent=v; }
  function fmtCoord(v,p,n) { if(v==null) return '—'; return Math.abs(v).toFixed(3)+'° '+(v>=0?p:n); }

  document.addEventListener('DOMContentLoaded', boot);
})();
