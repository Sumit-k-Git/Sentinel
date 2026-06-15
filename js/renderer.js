/**
 * renderer.js — Mini-map renderer (v5)
 * All satellites get trails with dual glow+core pass.
 * Offline sats shown as dim ghosts.  Demo sats get ⟳ label suffix.
 */
window.Renderer = (function () {
  'use strict';

  var _sats  = {};
  var _myLat = null;
  var _myLon = null;
  var opts = { stars:true, constellations:true, grid:true, terminator:true, orbitPath:true };

  function setOpts(o)          { for (var k in o) opts[k] = o[k]; }
  function setSatellites(s)    { _sats = s; }
  function setMyLocation(a, b) { _myLat = a; _myLon = b; }

  function xy(W, H, lon, lat) {
    return { x: ((lon + 180) / 360) * W, y: ((90 - lat) / 180) * H };
  }

  function drawMini(ctx, W, H, t) {
    /* Pure void — no paper texture */
    var bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.75);
    bg.addColorStop(0, '#00080f');
    bg.addColorStop(0.6, '#00050c');
    bg.addColorStop(1, '#000208');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    nebula(ctx, W, H, t);
    if (opts.grid)        grid(ctx, W, H);
    StarField.draw(ctx, W, H, t, opts.stars);
    if (opts.terminator)  terminator(ctx, W, H);
    continents(ctx, W, H);
    if (opts.constellations) constellations(ctx, W, H);
    if (opts.orbitPath)   orbits(ctx, W, H);
    trails(ctx, W, H);
    satellites(ctx, W, H, t);
    if (_myLat !== null) { myMarker(ctx, W, H); lines(ctx, W, H); }
  }

  function nebula(ctx, W, H, t) {
    var s = t * 0.000015;
    var g = ctx.createRadialGradient(
      W*0.25 + Math.sin(s)*W*0.03, H*0.4, 0,
      W*0.25, H*0.4, W*0.3);
    g.addColorStop(0, 'rgba(0,20,50,0.06)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function grid(ctx, W, H) {
    ctx.strokeStyle = 'rgba(0,70,120,0.12)';
    ctx.lineWidth   = 0.35;
    for (var lo = -180; lo <= 180; lo += 30) {
      var x = ((lo + 180) / 360) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (var la = -90; la <= 90; la += 30) {
      var y = ((90 - la) / 180) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(0,140,220,0.14)';
    ctx.lineWidth   = 0.6;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    ctx.fillStyle   = 'rgba(0,90,150,0.28)';
    ctx.font        = Math.max(7, W*0.009) + 'px Rajdhani,sans-serif';
    for (var ll = -150; ll <= 180; ll += 60) {
      ctx.fillText(ll + '°', ((ll+180)/360)*W + 2, H - 3);
    }
  }

  function terminator(ctx, W, H) {
    var now  = new Date();
    var doy  = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    var sLon = -((now.getUTCHours()*3600 + now.getUTCMinutes()*60 + now.getUTCSeconds()) / 86400) * 360;
    var sLat = 23.45 * Math.sin((2*Math.PI/365)*(doy - 81));
    var sx   = ((sLon+180+720)%360/360)*W;
    var sy   = ((90-sLat)/180)*H;
    var ax   = (sx + W/2) % W;
    var ay   = H - sy;
    var g    = ctx.createRadialGradient(ax, ay, 0, ax, ay, W*0.55);
    g.addColorStop(0, 'rgba(0,3,10,0.52)');
    g.addColorStop(0.38, 'rgba(0,3,10,0.24)');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function continents(ctx, W, H) {
    ctx.strokeStyle = 'rgba(0,120,200,0.1)';
    ctx.lineWidth   = 0.6;
    for (var s = 0; s < CONT.length; s++) {
      var shape   = CONT[s];
      var started = false;
      var lx      = null;
      ctx.beginPath();
      for (var i = 0; i < shape.length; i++) {
        var p = xy(W, H, shape[i][0], shape[i][1]);
        if (!started) { ctx.moveTo(p.x, p.y); started = true; lx = p.x; }
        else {
          if (Math.abs(p.x - lx) > W*0.5) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
          lx = p.x;
        }
      }
      ctx.closePath(); ctx.stroke();
    }
  }

  function constellations(ctx, W, H) {
    for (var ci = 0; ci < CONSTELLATION_DATA.length; ci++) {
      var c   = CONSTELLATION_DATA[ci];
      var pts = c.stars.map(function(s) { return xy(W, H, s[0]-180, s[1]); });
      ctx.strokeStyle = 'rgba(25,70,170,0.1)';
      ctx.lineWidth   = 0.5;
      if (c.lines) {
        for (var li = 0; li < c.lines.length; li++) {
          var a = pts[c.lines[li][0]], b = pts[c.lines[li][1]];
          if (!a || !b || Math.abs(a.x - b.x) > W*0.4) continue;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle   = '#6090c8';
      for (var pi = 0; pi < pts.length; pi++) {
        ctx.beginPath(); ctx.arc(pts[pi].x, pts[pi].y, 1.3, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  function orbits(ctx, W, H) {
    var ids = Object.keys(_sats);
    for (var i = 0; i < ids.length; i++) {
      var sat = _sats[parseInt(ids[i], 10)];
      if (!sat || !sat.orbit || sat.orbit.length < 2 || sat.offline) continue;
      var cat = SATELLITE_CATALOG[parseInt(ids[i], 10)];
      if (!cat) continue;
      var col = hexRgb(cat.color);
      ctx.strokeStyle = 'rgba(' + col + ',0.12)';
      ctx.lineWidth   = 0.8;
      ctx.setLineDash([3, 9]);
      var lx = null;
      ctx.beginPath();
      for (var j = 0; j < sat.orbit.length; j++) {
        var p = xy(W, H, sat.orbit[j][1], sat.orbit[j][0]);
        if (lx === null) { ctx.moveTo(p.x, p.y); lx = p.x; }
        else { if (Math.abs(p.x-lx) > W*0.45) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); lx = p.x; }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function trails(ctx, W, H) {
    var ids = Object.keys(_sats);
    for (var i = 0; i < ids.length; i++) {
      var id  = parseInt(ids[i], 10);
      var sat = _sats[id];
      if (!sat || !sat.trail || sat.trail.length < 2 || sat.offline) continue;
      var cat = SATELLITE_CATALOG[id];
      if (!cat) continue;
      var col = hexRgb(cat.color);
      for (var j = 1; j < sat.trail.length; j++) {
        var a = xy(W, H, sat.trail[j-1][1], sat.trail[j-1][0]);
        var b = xy(W, H, sat.trail[j][1],   sat.trail[j][0]);
        if (Math.abs(a.x - b.x) > W*0.4) continue;
        var f = j / sat.trail.length;
        /* Glow pass */
        ctx.strokeStyle = 'rgba(' + col + ',' + (f*0.10) + ')';
        ctx.lineWidth   = 3.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        /* Core trail */
        ctx.strokeStyle = 'rgba(' + col + ',' + (f*0.70) + ')';
        ctx.lineWidth   = 1.3;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
    }
  }

  function satellites(ctx, W, H, t) {
    var pulse = 0.5 + 0.5 * Math.sin(t * 0.0035);
    var ids   = Object.keys(_sats);
    for (var i = 0; i < ids.length; i++) {
      var id  = parseInt(ids[i], 10);
      var sat = _sats[id];
      var cat = SATELLITE_CATALOG[id];
      if (!cat) continue;
      if (sat.offline) { ghostSat(ctx, W, H, sat, cat); continue; }
      if (sat.lat === undefined) continue;
      var p   = xy(W, H, sat.lon, sat.lat);
      var col = hexRgb(cat.color);
      var isDm = sat.demo === true;

      /* Ambient glow */
      var gv = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, W*0.035);
      gv.addColorStop(0, 'rgba(' + col + ',' + (isDm ? 0.07 : 0.14) + ')');
      gv.addColorStop(1, 'transparent');
      ctx.fillStyle = gv; ctx.fillRect(0, 0, W, H);

      /* Sonar ring */
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.15*pulse) + ')';
      ctx.lineWidth   = 0.7;
      ctx.beginPath(); ctx.arc(p.x, p.y, W*0.02, 0, Math.PI*2); ctx.stroke();

      /* Crosshair */
      var cs = W * 0.014;
      ctx.shadowColor = cat.color;
      ctx.shadowBlur  = isDm ? 3 : 6;
      ctx.strokeStyle = 'rgba(' + col + ',' + (isDm ? 0.5 : 0.85) + ')';
      ctx.lineWidth   = 1.0;
      var gap = cs * 0.28;
      ctx.beginPath();
      ctx.moveTo(p.x-cs, p.y); ctx.lineTo(p.x-gap, p.y);
      ctx.moveTo(p.x+gap, p.y); ctx.lineTo(p.x+cs, p.y);
      ctx.moveTo(p.x, p.y-cs); ctx.lineTo(p.x, p.y-gap);
      ctx.moveTo(p.x, p.y+gap); ctx.lineTo(p.x, p.y+cs);
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* Core dot */
      ctx.fillStyle = 'rgba(' + col + ',' + (isDm ? 0.6 : 0.9) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + pulse, 0, Math.PI*2); ctx.fill();

      /* Label */
      ctx.fillStyle = 'rgba(' + col + ',' + (isDm ? 0.5 : 0.75) + ')';
      ctx.font      = Math.max(7, W*0.008) + 'px Rajdhani,sans-serif';
      ctx.fillText(cat.short + (isDm ? ' ⟳' : ''), p.x + cs + 3, p.y - 5);
    }
  }

  function ghostSat(ctx, W, H, sat, cat) {
    var trail = sat.trail;
    if (!trail || !trail.length) return;
    var last = trail[trail.length - 1];
    var p    = xy(W, H, last[1], last[0]);
    ctx.strokeStyle = 'rgba(80,80,100,0.25)';
    ctx.lineWidth   = 0.7;
    ctx.beginPath(); ctx.arc(p.x, p.y, W*0.015, 0, Math.PI*2); ctx.stroke();
    var cs = W * 0.01;
    ctx.beginPath();
    ctx.moveTo(p.x-cs, p.y); ctx.lineTo(p.x+cs, p.y);
    ctx.moveTo(p.x, p.y-cs); ctx.lineTo(p.x, p.y+cs);
    ctx.stroke();
    ctx.fillStyle = 'rgba(80,80,100,0.35)';
    ctx.font      = Math.max(7, W*0.0075) + 'px Rajdhani,sans-serif';
    ctx.fillText(cat.short + ' ?', p.x + cs + 2, p.y - 4);
  }

  function myMarker(ctx, W, H) {
    var p = xy(W, H, _myLon, _myLat);
    ctx.shadowColor = '#ffaa00';
    ctx.shadowBlur  = 7;
    ctx.strokeStyle = 'rgba(255,170,0,0.75)';
    ctx.lineWidth   = 1.1;
    var s = W * 0.012;
    ctx.beginPath();
    ctx.moveTo(p.x-s, p.y); ctx.lineTo(p.x+s, p.y);
    ctx.moveTo(p.x, p.y-s); ctx.lineTo(p.x, p.y+s);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle  = 'rgba(255,170,0,0.7)';
    ctx.font       = Math.max(7, W*0.008) + 'px Rajdhani,sans-serif';
    ctx.fillText('YOU', p.x + s + 3, p.y - 4);
  }

  function lines(ctx, W, H) {
    var a   = xy(W, H, _myLon, _myLat);
    var ids = Object.keys(_sats);
    for (var i = 0; i < ids.length; i++) {
      var id  = parseInt(ids[i], 10);
      var sat = _sats[id];
      if (!sat || sat.offline || sat.lat === undefined) continue;
      var cat = SATELLITE_CATALOG[id]; if (!cat) continue;
      var b   = xy(W, H, sat.lon, sat.lat);
      if (Math.abs(a.x - b.x) > W*0.5) continue;
      var col = hexRgb(cat.color);
      var gl  = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      gl.addColorStop(0, 'rgba(255,170,0,0.09)');
      gl.addColorStop(1, 'rgba(' + col + ',0.04)');
      ctx.strokeStyle = gl;
      ctx.lineWidth   = 0.65;
      ctx.setLineDash([2, 9]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function hexRgb(h) {
    return parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16);
  }

  function getISSScreenPos(W, H) {
    var s = _sats[25544];
    if (!s || s.offline || s.lat === undefined) return null;
    return xy(W, H, s.lon, s.lat);
  }

  return {
    drawMini: drawMini, setOpts: setOpts,
    setSatellites: setSatellites, setMyLocation: setMyLocation,
    getISSScreenPos: getISSScreenPos
  };
})();

/* Continent outlines */
var CONT = [
  [[-168,72],[-140,70],[-120,68],[-100,74],[-80,74],[-60,68],[-50,56],[-52,46],[-66,44],[-70,42],[-76,35],[-80,25],[-88,15],[-85,10],[-78,8],[-75,8],[-72,12],[-60,7],[-55,4],[-50,0],[-48,2],[-52,12],[-58,15],[-64,18],[-66,20],[-68,22],[-74,18],[-80,15],[-84,9],[-86,8],[-88,15],[-98,19],[-105,20],[-110,22],[-115,30],[-118,34],[-124,38],[-124,46],[-126,50],[-130,56],[-136,59],[-140,58],[-148,60],[-155,62],[-164,68],[-168,72]],
  [[-80,8],[-76,2],[-72,-5],[-68,-14],[-66,-20],[-70,-30],[-72,-42],[-68,-54],[-64,-56],[-58,-52],[-52,-50],[-48,-28],[-44,-18],[-40,-8],[-34,-4],[-36,0],[-44,2],[-50,2],[-52,6],[-56,8],[-60,8],[-68,12],[-72,10],[-78,10],[-80,8]],
  [[10,60],[20,70],[28,72],[32,68],[26,62],[22,58],[18,55],[14,52],[8,48],[0,48],[-4,48],[-8,44],[-2,36],[10,36],[18,38],[26,36],[30,38],[36,38],[38,42],[40,42],[38,46],[34,50],[28,54],[22,58],[18,60],[14,58],[10,60]],
  [[14,38],[18,38],[26,36],[34,30],[40,22],[44,12],[44,0],[40,-8],[36,-18],[32,-26],[28,-36],[22,-36],[16,-34],[12,-28],[10,-18],[8,-6],[2,4],[-2,8],[-8,8],[-14,10],[-18,14],[-16,22],[-14,28],[-10,32],[-4,36],[2,38],[10,38],[14,38]],
  [[28,54],[38,46],[40,42],[44,40],[54,38],[60,36],[70,36],[76,34],[80,28],[86,22],[100,18],[106,10],[108,2],[112,-2],[116,-8],[120,-2],[128,4],[130,10],[128,18],[122,24],[120,30],[118,40],[122,46],[130,50],[132,44],[136,50],[138,58],[134,60],[128,60],[120,60],[108,56],[100,50],[92,56],[86,58],[80,62],[68,60],[60,62],[52,60],[44,62],[38,62],[32,60],[28,54]],
  [[114,-22],[118,-20],[124,-18],[130,-14],[136,-12],[140,-16],[144,-18],[148,-22],[152,-24],[154,-26],[152,-30],[148,-36],[144,-38],[140,-36],[136,-32],[130,-32],[126,-34],[122,-34],[116,-32],[114,-28],[114,-22]]
];
