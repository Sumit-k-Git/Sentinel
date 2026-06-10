# ⬡ Sub-Orbital Sentinel v2

**Live ISS tracker · Split control panel + clean projection view · No hardware needed**

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | **Control Panel** — ISS telemetry, your location, toggles, pass predictions |
| `view.html` | **Projection View** — fullscreen ambient map, clean HUD, for ceiling/wall |

Open both simultaneously. Changes in the control panel (location, toggles, brightness) sync live to the projection view via `BroadcastChannel`.

## Quick Start (Termux / local)

```bash
pkg install python -y
cd sub-orbital-sentinel
python3 -m http.server 8080
```
Open `http://localhost:8080` in browser.

## GitHub Pages Deploy

1. Push to a repo
2. Settings → Pages → Source → main / root
3. Live at `https://yourusername.github.io/sub-orbital-sentinel`

## Ceiling Projection

1. Open `view.html` in fullscreen (`F`)
2. Or press **CEILING FLIP MODE** in the control panel — flips 180° for overhead projection
3. Adjust brightness slider for room ambience

## Features

- Live ISS position via [wheretheiss.at](https://wheretheiss.at) — refreshed every 5s
- Orbital trail (80 points), predicted orbit arc, day/night terminator
- 8 constellations with star lines
- Your location + distance to ISS + pass ETA
- Demo/simulation mode if API is unavailable (CORS/offline)
- Real-time telemetry log
- BroadcastChannel sync between control and view windows

## Structure

```
├── index.html          Control panel
├── view.html           Projection view (clean, no distractions)
├── css/
│   └── control.css     Control panel styles
├── js/
│   ├── app.js          (unused in v2, kept for reference)
│   ├── control.js      Control panel logic
│   ├── renderer.js     Mini map renderer
│   ├── renderer-view.js  Full-screen view renderer
│   ├── tracker.js      ISS API + orbital math
│   ├── stars.js        Star field engine
│   └── satellites.js   Constellation + satellite data
└── README.md
```

MIT License
