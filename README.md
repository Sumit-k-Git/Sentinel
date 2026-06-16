# ⬡ Sub-Orbital Sentinel v5

**Live ISS & satellite tracker. Browser-only. No Raspberry Pi needed.**

## Quick Start (Termux / local)

```bash
cp /sdcard/Download/sentinel-v5.zip ~/
unzip sentinel-v5.zip && cd sentinel-v5
python3 -m http.server 8080
```
Open `http://localhost:8080` in Chrome or Firefox.

## Pages

| Page | Use |
|------|-----|
| `index.html` | Control panel — mode switcher, location, toggles |
| `view.html` | Projection view — open on TV / projector / ceiling |

## Tracking Modes

| Mode | How it works |
|------|-------------|
| **LIVE** | ISS: `wheretheiss.at` API (real-time). All other sats: CelesTrak TLE + SGP4 propagation (no key needed). |
| **CALCULATED** | All sats: CelesTrak TLE + satellite.js SGP4. Strict 14-day TLE freshness validation. Offline sats shown as ghosts — never simulated. |
| **DEMO** | Kinematic simulation. Explicit opt-in only. Clearly labelled. |

## N2YO API (Optional upgrade for non-ISS sats)

N2YO provides direct real-time positions but **blocks CORS in the browser**.
You need a local proxy:

```bash
# Install once
npm install -g local-cors-proxy

# Run proxy (leave this terminal open while using Sentinel)
npx local-cors-proxy --proxyUrl https://api.n2yo.com --port 8010
```

Then in the control panel:
1. Get a free API key at [n2yo.com/api](https://www.n2yo.com/api/)
2. Enter your key in **N2YO API KEY**
3. Enter `http://localhost:8010` in **CORS PROXY URL**

Without N2YO, all satellites still work via CelesTrak TLE+SGP4.

## Data Sources

| Source | Satellites | Key needed | CORS |
|--------|-----------|------------|------|
| wheretheiss.at | ISS only | None | ✅ Open |
| open-notify.org | ISS fallback | None | ✅ Open |
| CelesTrak gp.php | All 10 sats | None | ✅ Open |
| N2YO API | All sats | Free key | ❌ Needs proxy |

## GitHub Pages Deploy

1. Push this folder to a GitHub repo
2. Settings → Pages → Source → main branch
3. Done — live at `https://yourusername.github.io/sentinel-v5`

## Observability Notifications (Calculated mode)

Fires only when **all three conditions are true simultaneously**:
1. Satellite elevation **> 15°** above your horizon
2. Your location in **nautical twilight or full darkness** (SunCalc)
3. Satellite **illuminated by sun** (not in Earth's shadow — cylindrical eclipse model)

## File Structure

```
sentinel-v5/
├── index.html           Control panel
├── view.html            Projection view
├── css/control.css      All styles
├── js/
│   ├── api-layer.js     Multi-source API orchestrator
│   ├── tracker.js       Tri-mode tracker (Live/Calc/Demo)
│   ├── renderer.js      Mini-map canvas renderer
│   ├── renderer-view.js Full-screen projection renderer
│   ├── control.js       Control panel logic
│   ├── notifications.js 3-gate observability notifications
│   ├── audio.js         Generative ambient audio
│   ├── weather.js       Open-Meteo cloud cover overlay
│   ├── satellites.js    Satellite catalog + constellations
│   └── stars.js         Star field engine
├── manifest.json        PWA manifest
└── sw.js                Service worker (offline support)
```

MIT License
