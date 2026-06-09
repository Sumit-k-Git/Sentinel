// stars.js — Star field and constellation renderer

window.StarField = (function () {
  let stars = [];
  let miniStars = [];

  function generate(W, H, count) {
    stars = [];
    const n = count || Math.floor((W * H) / 1200);
    for (let i = 0; i < n; i++) {
      const bright = Math.random();
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: bright > 0.95 ? 1.6 : bright > 0.8 ? 1.0 : 0.5,
        bright,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.2,
        // Colour: most white-blue, rare warm
        hue: Math.random() > 0.9 ? (Math.random() > 0.5 ? 30 : 200) : 210,
      });
    }
    return stars;
  }

  function generateMini(size) {
    miniStars = [];
    for (let i = 0; i < 180; i++) {
      miniStars.push({
        x: Math.random() * size,
        y: Math.random() * size,
        r: Math.random() * 1.2 + 0.3,
        bright: Math.random(),
        phase: Math.random() * Math.PI * 2,
      });
    }
    return miniStars;
  }

  function draw(ctx, W, H, t, showStars) {
    if (!showStars) return;
    for (const s of stars) {
      const tw = 0.7 + 0.3 * Math.sin(t * 0.001 * s.speed + s.phase);
      const alpha = (0.2 + s.bright * 0.75) * tw;
      ctx.globalAlpha = alpha;
      if (s.r > 1.3) {
        // Bright star — add cross spike
        ctx.strokeStyle = `hsl(${s.hue}, 60%, 90%)`;
        ctx.lineWidth = 0.3;
        ctx.globalAlpha = alpha * 0.4;
        ctx.beginPath();
        ctx.moveTo(s.x - s.r * 3, s.y);
        ctx.lineTo(s.x + s.r * 3, s.y);
        ctx.moveTo(s.x, s.y - s.r * 3);
        ctx.lineTo(s.x, s.y + s.r * 3);
        ctx.stroke();
        ctx.globalAlpha = alpha;
      }
      ctx.fillStyle = `hsl(${s.hue}, 50%, ${80 + s.bright * 20}%)`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawMini(ctx, size, myLat, myLon, t) {
    ctx.fillStyle = '#010812';
    ctx.fillRect(0, 0, size, size);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.clip();

    for (const s of miniStars) {
      const tw = 0.7 + 0.3 * Math.sin(t * 0.0008 + s.phase);
      ctx.globalAlpha = (0.3 + s.bright * 0.6) * tw;
      ctx.fillStyle = '#a0d4ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (myLat !== null) {
      // Draw visible constellations above horizon
      drawMiniConstellations(ctx, size, myLat, myLon, t);
    }

    // Zenith crosshair
    ctx.strokeStyle = 'rgba(0,212,255,0.4)';
    ctx.lineWidth = 0.8;
    const cx = size / 2, cy = size / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,212,255,0.5)';
    ctx.stroke();

    // Cardinal labels
    ctx.fillStyle = 'rgba(74,122,155,0.8)';
    ctx.font = '7px Space Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', size / 2, 10);
    ctx.fillText('S', size / 2, size - 4);
    ctx.textAlign = 'left';
    ctx.fillText('E', 4, size / 2 + 3);
    ctx.textAlign = 'right';
    ctx.fillText('W', size - 4, size / 2 + 3);
    ctx.textAlign = 'start';

    ctx.restore();
  }

  function drawMiniConstellations(ctx, size, myLat, myLon, t) {
    const siderealH = getSiderealHour(myLon);
    for (const c of window.CONSTELLATION_DATA) {
      // Convert star RA/Dec to azimuth/altitude
      const altAzStars = c.stars.map(([ra, dec]) => {
        return raDecToAltAz(ra, dec, myLat, siderealH);
      });
      // Only draw if at least one star above horizon
      const visible = altAzStars.some(s => s.alt > -10);
      if (!visible) continue;

      const pts = altAzStars.map(({ alt, az }) => {
        const r = (size / 2) * (1 - (alt + 90) / 180);
        const angle = (az - 90) * Math.PI / 180;
        return {
          x: size / 2 + r * Math.cos(angle),
          y: size / 2 + r * Math.sin(angle),
          visible: alt > 0
        };
      });

      ctx.strokeStyle = 'rgba(60,120,200,0.3)';
      ctx.lineWidth = 0.6;
      for (const [a, b] of c.lines || []) {
        if (pts[a] && pts[b]) {
          ctx.beginPath();
          ctx.moveTo(pts[a].x, pts[a].y);
          ctx.lineTo(pts[b].x, pts[b].y);
          ctx.stroke();
        }
      }
      for (const p of pts) {
        if (!p.visible) continue;
        ctx.fillStyle = 'rgba(160,200,255,0.6)';
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  function getSiderealHour(lon) {
    const now = new Date();
    const J = (now.getTime() / 86400000) + 2440587.5;
    const T = (J - 2451545.0) / 36525;
    let GMST = 280.46061837 + 360.98564736629 * (J - 2451545.0) + 0.000387933 * T * T;
    GMST = ((GMST % 360) + 360) % 360;
    return (GMST + lon + 360) % 360;
  }

  function raDecToAltAz(ra, dec, lat, lst) {
    const ha = (lst - ra + 360) % 360;
    const haR = ha * Math.PI / 180;
    const decR = dec * Math.PI / 180;
    const latR = lat * Math.PI / 180;
    const sinAlt = Math.sin(decR) * Math.sin(latR) + Math.cos(decR) * Math.cos(latR) * Math.cos(haR);
    const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180 / Math.PI;
    const cosAz = (Math.sin(decR) - Math.sin(latR) * sinAlt) / (Math.cos(latR) * Math.cos(Math.asin(sinAlt)));
    let az = Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180 / Math.PI;
    if (Math.sin(haR) > 0) az = 360 - az;
    return { alt, az };
  }

  return { generate, generateMini, draw, drawMini, getSiderealHour };
})();
