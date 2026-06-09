# ⬡ Sub-Orbital Sentinel v2

> A live ISS tracking and projection experience that I built for space enthusiasts, makers, educators, and anyone who wants a beautiful real-time orbital display without specialized hardware.

## 🚀 About the Project

Hi! I'm the creator of **Sub-Orbital Sentinel v2**.

I designed this project to provide a clean and immersive way to track the **International Space Station (ISS)** in real time. The project includes both a powerful control panel and a distraction-free projection view that can be displayed on walls, monitors, projectors, or ceilings.

Whether you're experimenting with home planetariums, learning about orbital mechanics, or just enjoying space data, this project is designed to be easy to deploy and simple to customize.

---

## ✨ Features

- Live ISS position tracking
- Real-time telemetry updates
- Full-screen projection mode
- Ceiling projection support (180° flip mode)
- Orbital trail and predicted orbit arc
- Day/Night terminator visualization
- Star field and constellation rendering
- Distance calculations from your location
- Pass predictions and tracking tools
- Offline/demo mode when APIs are unavailable
- Live synchronization between windows using BroadcastChannel

---

## 📄 Pages

| Page | Purpose |
|--------|---------|
| `index.html` | Control Panel – telemetry, location settings, controls, predictions |
| `view.html` | Projection View – fullscreen visualization for displays and projectors |

Both pages can be opened simultaneously.

Any changes made in the Control Panel are automatically synchronized to the Projection View in real time.

---

## 🛠️ Project Structure

```text
├── index.html
├── view.html
├── css/
│   └── control.css
├── js/
│   ├── app.js
│   ├── control.js
│   ├── renderer.js
│   ├── renderer-view.js
│   ├── tracker.js
│   ├── stars.js
│   └── satellites.js
└── README.md
```

---

## ⚡ Running Locally

### Windows

#### Option 1: Python HTTP Server

1. Install Python from https://www.python.org
2. Open Command Prompt or PowerShell.
3. Navigate to the project directory:

```powershell
cd sub-orbital-sentinel
```

4. Start a local server:

```powershell
python -m http.server 8080
```

5. Open:

```text
http://localhost:8080
```

---

### Linux (Ubuntu, Debian, Fedora, Arch, etc.)

Ensure Python 3 is installed:

```bash
python3 --version
```

Start the local server:

```bash
cd sub-orbital-sentinel
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

---

### macOS

```bash
cd sub-orbital-sentinel
python3 -m http.server 8080
```

Then visit:

```text
http://localhost:8080
```

---

### Android (Termux)

```bash
pkg update -y
pkg install python -y

cd sub-orbital-sentinel
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

---

## 🌍 Deploying to GitHub Pages

If you'd like to host your own copy:

1. Fork this repository.
2. Clone your fork locally.
3. Push your changes.
4. Open GitHub repository settings.
5. Navigate to **Pages**.
6. Select:

```text
Source: Deploy from Branch
Branch: main
Folder: / (root)
```

7. Save the settings.

Your site will be available at:

```text
https://yourusername.github.io/sub-orbital-sentinel
```

---

## 🛰️ Using Projection Mode

### Standard Projection

1. Open `view.html`
2. Enter fullscreen mode (`F11` in most browsers)
3. Enjoy the live orbital visualization

### Ceiling Projection

1. Open the Control Panel
2. Click **Ceiling Flip Mode**
3. The display rotates 180° for overhead projection
4. Adjust brightness to match room lighting

---

## 🔄 How Synchronization Works

The project uses the browser's **BroadcastChannel API** to synchronize:

- Location updates
- Brightness settings
- Projection preferences
- UI toggles

This allows the control panel and projection view to stay synchronized in real time.

---

## 📡 Data Source

ISS location data is provided by:

- wheretheiss.at

When the API becomes unavailable, the application automatically switches to a simulation/demo mode to maintain functionality.

---

## 🤝 Contributing

Pull requests, bug reports, and feature suggestions are welcome.

If you improve the project, feel free to open an issue or submit a pull request so others can benefit from the enhancement.

---

## 📜 License

MIT License

Feel free to use, modify, and distribute this project according to the license terms.
