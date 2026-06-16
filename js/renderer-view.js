/**
 * renderer-view.js — Full-screen projection renderer (v5)
 * Used by view.html. Draws all satellites with trails, orbit paths,
 * ambient glow, constellations, terminator, day/night, weather overlay.
 * No paper background — pure deep space radial void.
 */
window.RendererView = (function () {
  'use strict';

  var canvas, ctx, W, H;
  var _sats  = {};
  var _myLat = null;
  var _myLon = null;
  var _pov   = 'my_location';
  var opts   = { stars:true, constellations:true, grid:true, terminator:true, orbitPath:true };

  function init(c)  { canvas = c; ctx = canvas.getContext('2d'); resize(); }
  function resize() { W = canvas.width = window.innerWidth; H = canvas.height = window.innerHeight; }
  function setOpts(o)           { for (var k in o) opts[k] = o[k]; }
  function setSatellites(s)     { _sats = s; }
  function setMyLocation(la,lo) { _myLat = la; _myLon = lo; }
  function setPOV(p)            { _pov = p; }

  function xy(lon, lat) {
    return { x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H };
  }

  function draw(t) {
    /* Pure void — no paper, no texture */
    var bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.8);
    bg.addColorStop(0, '#00080f');
    bg.addColorStop(0.5, '#00050c');
    bg.addColorStop(1, '#000208');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    nebula(t);
    if (opts.grid)          grid();
    StarField.draw(ctx, W, H, t, opts.stars);
    if (opts.terminator)    terminator();
    continents();
    if (opts.constellations) constellations(t);
    if (window.WeatherLayer && WeatherLayer.isEnabled()) WeatherLayer.draw(ctx, W, H, _myLat, _myLon);
    if (opts.orbitPath)     orbits();
    trails(t);
    satellites(t);
    if (_myLat !== null) { myMarker(); pullLines(); }
  }

  function nebula(t) {
    var s = t * 0.000018;
    var blobs = [
      { cx: W*0.2, cy: H*0.3, r: W*0.35, c: 'rgba(0,20,50,0.055)', dx: 0.04, dy: 0.03 },
      { cx: W*0.75, cy: H*0.6, r: W*0.30, c: 'rgba(20,0,50,0.04)',  dx: 0.03, dy: 0.05 },
      { cx: W*0.5,  cy: H*0.15,r: W*0.25, c: 'rgba(0,30,60,0.04)',  dx: 0.05, dy: 0.02 }
    ];
    blobs.forEach(function(b) {
      var bx = b.cx + Math.sin(s * b.dx) * W * 0.03;
      var by = b.cy + Math.cos(s * b.dy) * H * 0.03;
      var g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r);
      g.addColorStop(0, b.c); g.addColorStop(1, 'transparent');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    });
  }

  function grid() {
    ctx.lineWidth = 0.35; ctx.strokeStyle = 'rgba(0,70,120,0.12)';
    for (var lo = -180; lo <= 180; lo += 30) {
      var x = ((lo+180)/360)*W;
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for (var la = -90; la <= 90; la += 30) {
      var y = ((90-la)/180)*H;
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,140,220,0.15)'; ctx.lineWidth = 0.7;
    ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
    ctx.fillStyle = 'rgba(0,90,150,0.28)';
    ctx.font = Math.max(8, W*0.0082) + 'px Rajdhani,sans-serif';
    for (var ll = -150; ll <= 180; ll += 60) ctx.fillText(ll+'°', ((ll+180)/360)*W+2, H-5);
    for (var lat2 = -60; lat2 <= 90; lat2 += 30) { if (lat2===0) continue; ctx.fillText(lat2+'°', 2, ((90-lat2)/180)*H-2); }
    ctx.fillStyle = 'rgba(0,180,255,0.35)'; ctx.fillText('0°', 2, H/2-2);
  }

  function terminator() {
    var now = new Date();
    var doy = Math.floor((now - new Date(now.getFullYear(),0,0)) / 86400000);
    var sLon = -((now.getUTCHours()*3600 + now.getUTCMinutes()*60 + now.getUTCSeconds()) / 86400) * 360;
    var sLat = 23.45 * Math.sin((2*Math.PI/365)*(doy-81));
    var sx = ((sLon+180+720)%360/360)*W, sy = ((90-sLat)/180)*H;
    var ax = (sx+W/2)%W, ay = H-sy;
    var g = ctx.createRadialGradient(ax,ay,0,ax,ay,W*0.58);
    g.addColorStop(0, 'rgba(0,3,10,0.58)');
    g.addColorStop(0.38, 'rgba(0,3,10,0.28)');
    g.addColorStop(0.68, 'rgba(0,3,10,0.07)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
  }

  function continents() {
    ctx.strokeStyle = 'rgba(0,120,200,0.10)'; ctx.lineWidth = 0.65;
    VIEW_CONT.forEach(function(shape) {
      ctx.beginPath(); var started=false, lx=null;
      shape.forEach(function(pt) {
        var p = xy(pt[0], pt[1]);
        if (!started) { ctx.moveTo(p.x,p.y); started=true; lx=p.x; }
        else { if (Math.abs(p.x-lx)>W*0.5) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); lx=p.x; }
      });
      ctx.closePath(); ctx.stroke();
    });
  }

  function constellations(t) {
    CONSTELLATION_DATA.forEach(function(c) {
      var pts = c.stars.map(function(s) { return xy(s[0]-180, s[1]); });
      ctx.strokeStyle = 'rgba(25,70,170,0.11)'; ctx.lineWidth = 0.6;
      if (c.lines) c.lines.forEach(function(l) {
        var a = pts[l[0]], b = pts[l[1]];
        if (!a||!b||Math.abs(a.x-b.x)>W*0.4) return;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      });
      pts.forEach(function(p) {
        ctx.globalAlpha=0.38; ctx.fillStyle='#6a9fd8';
        ctx.beginPath(); ctx.arc(p.x,p.y,1.5,0,Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha=0.13; ctx.fillStyle='#5580c0';
      ctx.font = Math.max(7,W*0.007)+'px Rajdhani,sans-serif';
      if (pts[0]) ctx.fillText(c.name, pts[0].x+4, pts[0].y-4);
      ctx.globalAlpha = 1;
    });
  }

  function orbits() {
    Object.keys(_sats).forEach(function(idStr) {
      var id  = parseInt(idStr, 10);
      var sat = _sats[id];
      if (!sat || !sat.orbit || sat.orbit.length < 2 || sat.offline) return;
      var cat = SATELLITE_CATALOG[id]; if (!cat) return;
      var col = hexRgb(cat.color);
      ctx.strokeStyle = 'rgba('+col+',0.07)'; ctx.lineWidth = 3; ctx.setLineDash([4,12]);
      drawOrbitPath(sat.orbit);
      ctx.strokeStyle = 'rgba('+col+',0.20)'; ctx.lineWidth = 1; ctx.setLineDash([3,9]);
      drawOrbitPath(sat.orbit);
      ctx.setLineDash([]);
    });
  }

  function drawOrbitPath(orbit) {
    var lx = null; ctx.beginPath();
    orbit.forEach(function(o) {
      var p = xy(o[1], o[0]);
      if (lx===null) { ctx.moveTo(p.x,p.y); lx=p.x; }
      else { if (Math.abs(p.x-lx)>W*0.45) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y); lx=p.x; }
    });
    ctx.stroke();
  }

  function trails(t) {
    Object.keys(_sats).forEach(function(idStr) {
      var id  = parseInt(idStr, 10);
      var sat = _sats[id];
      if (!sat || !sat.trail || sat.trail.length < 2 || sat.offline) return;
      var cat = SATELLITE_CATALOG[id]; if (!cat) return;
      var col = hexRgb(cat.color);
      for (var i = 1; i < sat.trail.length; i++) {
        var a = xy(sat.trail[i-1][1], sat.trail[i-1][0]);
        var b = xy(sat.trail[i][1],   sat.trail[i][0]);
        if (Math.abs(a.x-b.x) > W*0.4) continue;
        var f = i / sat.trail.length;
        ctx.strokeStyle = 'rgba('+col+','+(f*0.08)+')'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
        ctx.strokeStyle = 'rgba('+col+','+(f*0.70)+')'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      }
    });
  }

  function satellites(t) {
    var pulse  = 0.5 + 0.5 * Math.sin(t * 0.0035);
    var pulse2 = 0.5 + 0.5 * Math.sin(t * 0.005 + 1);
    Object.keys(_sats).forEach(function(idStr) {
      var id  = parseInt(idStr, 10);
      var sat = _sats[id];
      var cat = SATELLITE_CATALOG[id]; if (!cat) return;
      if (sat.offline || sat.lat === undefined) return;
      var p    = xy(sat.lon, sat.lat);
      var col  = hexRgb(cat.color);
      var isDm = sat.demo === true;
      var alpha = isDm ? 0.55 : 1.0;

      /* Outer glow */
      var rOuter = W*0.025 + W*0.006*pulse;
      var gOuter = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,rOuter);
      gOuter.addColorStop(0,'rgba('+col+','+(0.08*alpha)+')');
      gOuter.addColorStop(1,'transparent');
      ctx.fillStyle = gOuter; ctx.fillRect(0,0,W,H);

      /* Sonar rings */
      for (var r = 1; r <= 4; r++) {
        var rr = (r * W*0.016) * (0.75 + 0.25*pulse);
        var ra = ((5-r)/5) * 0.14 * pulse2 * alpha;
        ctx.strokeStyle = 'rgba('+col+','+ra+')'; ctx.lineWidth = 0.75;
        ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,Math.PI*2); ctx.stroke();
      }

      /* Crosshair */
      var cs = W * 0.016;
      ctx.shadowColor = cat.color; ctx.shadowBlur = isDm ? 5 : 12;
      ctx.strokeStyle = 'rgba('+col+','+(0.9*alpha)+')'; ctx.lineWidth = isDm ? 0.8 : 1.2;
      var gap = cs * 0.28;
      ctx.beginPath();
      ctx.moveTo(p.x-cs,p.y); ctx.lineTo(p.x-gap,p.y);
      ctx.moveTo(p.x+gap,p.y); ctx.lineTo(p.x+cs,p.y);
      ctx.moveTo(p.x,p.y-cs); ctx.lineTo(p.x,p.y-gap);
      ctx.moveTo(p.x,p.y+gap); ctx.lineTo(p.x,p.y+cs);
      ctx.stroke();
      if (!isDm) {
        var d45 = cs*0.38;
        ctx.strokeStyle = 'rgba('+col+',0.3)'; ctx.lineWidth = 0.65;
        ctx.beginPath();
        ctx.moveTo(p.x-d45,p.y-d45); ctx.lineTo(p.x-d45*0.5,p.y-d45*0.5);
        ctx.moveTo(p.x+d45,p.y-d45); ctx.lineTo(p.x+d45*0.5,p.y-d45*0.5);
        ctx.moveTo(p.x-d45,p.y+d45); ctx.lineTo(p.x-d45*0.5,p.y+d45*0.5);
        ctx.moveTo(p.x+d45,p.y+d45); ctx.lineTo(p.x+d45*0.5,p.y+d45*0.5);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      /* Core dot */
      var dotR = (isDm ? 2.5 : 3.5) + (isDm ? 0 : 1.2*pulse);
      var gc = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,dotR*2.5);
      gc.addColorStop(0,'rgba(255,255,255,'+(0.95*alpha)+')');
      gc.addColorStop(0.4,'rgba('+col+','+(0.9*alpha)+')');
      gc.addColorStop(1,'transparent');
      ctx.fillStyle = gc;
      ctx.beginPath(); ctx.arc(p.x,p.y,dotR*2.5,0,Math.PI*2); ctx.fill();

      /* Label */
      ctx.fillStyle = 'rgba('+col+','+(isDm?0.5:0.85)*alpha+')';
      ctx.font = (isDm?'':'bold ')+Math.max(8,W*0.009)+'px Rajdhani,sans-serif';
      ctx.fillText(cat.short+(isDm?' ⟳':''), p.x+cs+4, p.y-5);
      if (!isDm) {
        ctx.fillStyle = 'rgba('+col+',0.45)';
        ctx.font = Math.max(7,W*0.0072)+'px Rajdhani,sans-serif';
        ctx.fillText((sat.alt?sat.alt.toFixed(0):'—')+' km', p.x+cs+4, p.y+9);
      }
    });
  }

  function myMarker() {
    var p = xy(_myLon, _myLat);
    ctx.shadowColor = '#ffaa00'; ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(255,170,0,0.8)'; ctx.lineWidth = 1.3;
    var s = W*0.011;
    ctx.beginPath();
    ctx.moveTo(p.x-s,p.y); ctx.lineTo(p.x+s,p.y);
    ctx.moveTo(p.x,p.y-s); ctx.lineTo(p.x,p.y+s);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,170,0,0.35)'; ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(p.x,p.y-s*0.7); ctx.lineTo(p.x+s*0.7,p.y);
    ctx.lineTo(p.x,p.y+s*0.7); ctx.lineTo(p.x-s*0.7,p.y);
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,200,80,0.75)';
    ctx.font = 'bold '+Math.max(8,W*0.008)+'px Rajdhani,sans-serif';
    ctx.fillText('YOU', p.x+s+4, p.y-4);
  }

  function pullLines() {
    var a = xy(_myLon, _myLat);
    Object.keys(_sats).forEach(function(idStr) {
      var id  = parseInt(idStr, 10);
      var sat = _sats[id];
      if (!sat || sat.offline || sat.lat===undefined) return;
      var cat = SATELLITE_CATALOG[id]; if (!cat) return;
      var b = xy(sat.lon, sat.lat);
      if (Math.abs(a.x-b.x) > W*0.5) return;
      var col = hexRgb(cat.color);
      var gl = ctx.createLinearGradient(a.x,a.y,b.x,b.y);
      gl.addColorStop(0,'rgba(255,170,0,0.1)');
      gl.addColorStop(1,'rgba('+col+',0.05)');
      ctx.strokeStyle = gl; ctx.lineWidth = 0.8; ctx.setLineDash([2,8]);
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      ctx.setLineDash([]);
    });
  }

  function hexRgb(h) {
    return parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16);
  }

  function getScreenPos(lon, lat) { return xy(lon, lat); }

  return {
    init: init, resize: resize, draw: draw,
    setOpts: setOpts, setSatellites: setSatellites,
    setMyLocation: setMyLocation, setPOV: setPOV,
    getScreenPos: getScreenPos
  };
})();

/* Continent shapes for view renderer */
var VIEW_CONT = [
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]]
];
