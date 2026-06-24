# 🍰 Kawaii Messy Bakery Organizer

A cute, cozy WebXR-ready browser game built with **A-Frame**. Clean up a messy
kawaii bakery by putting croissants, pastries, bread, dirty dishes, and
decorations back where they belong!

Runs in your desktop browser today, and is structured so it can be upgraded
for **Meta Quest VR** later with minimal changes.

---

## 🎮 How to Play

1. **Look around** — move your mouse to look (click the screen first to lock
   the pointer).
2. **Move** — use **WASD** keys to walk around the bakery.
3. **Pick up an item** — click on any messy item (croissant, pastry, bread,
   dirty dish, or bow decoration). It will glow and float in front of you.
4. **Place it** — walk toward the matching glowing zone and click it:
   - 🥐 Croissants → **Croissant Rack** (top-left shelf)
   - 🍰 Pastries → **Pastry Display** (top-right shelf)
   - 🍞 Bread → **Bread Shelf** (top shelf, center)
   - 🍽️ Dirty dishes → **Sink** (right side of room)
   - 🎀 Decorations → **Decoration Shelf** (right wall)
5. If you click the wrong zone, nothing bad happens — just try a different
   spot. No timers, no fail state — just relax and tidy up!
6. When all **10 items** are placed correctly, you'll see:
   **"✨ Bakery Organized! ✨"**

---

## 📁 Project Structure

```
kawaii-bakery/
├── index.html        # Main A-Frame scene (room, items, zones, UI)
├── js/
│   ├── components.js # A-Frame components (pickup, drop-zone, hover glow)
│   └── game.js        # Game logic (holding items, placement, win condition)
└── README.md
```

---

## 🖥️ Setup: Clone & Run Locally (Mac + VS Code + Live Server)

### 1. Clone the repository

Open **Terminal** and run:

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
cd YOUR-REPO-NAME
```

> Replace `YOUR-USERNAME/YOUR-REPO-NAME` with your actual GitHub repo path.

### 2. Open the project in VS Code

```bash
code .
```

(If `code` isn't recognized, open VS Code manually and use
**File → Open Folder...** to select the `kawaii-bakery` folder.)

### 3. Install the Live Server extension

1. In VS Code, click the **Extensions** icon in the sidebar (or press
   `Cmd+Shift+X`).
2. Search for **"Live Server"** by Ritwick Dey.
3. Click **Install**.

### 4. Run the project with Live Server

1. In the VS Code file explorer, right-click `index.html`.
2. Select **"Open with Live Server"**.
3. Your browser (Chrome recommended) will open automatically at something
   like `http://127.0.0.1:5500/index.html`.
4. Click anywhere on the scene to lock your mouse, then use **WASD** + mouse
   to explore the bakery!

> ⚠️ A-Frame requires the page to be served over `http://` (not opened
> directly as a `file://` path), which is exactly what Live Server provides.

---

## 🥽 WebXR / Meta Quest Notes

This project already includes:

- `vr-mode-ui="enabled: true"` on the `<a-scene>` — shows the **"Enter VR"**
  button automatically when a WebXR-capable browser/headset is detected.
- A raycaster-based interaction system (works with both mouse **and**
  VR controllers without extra setup).
- A clean entity/component structure so future upgrades (like adding
  `laser-controls` for Quest controllers) only require small additions —
  no rewrite needed.

To test on Meta Quest later:
1. Make sure your computer and Quest are on the same network, or deploy the
   project to a hosting service (e.g. GitHub Pages, Netlify, Vercel).
2. Open the hosted URL in the Quest Browser.
3. Click **"Enter VR"** in the bottom-right corner of the scene.

---

## 🌱 Learning Git: Suggested Commit Workflow

If you're using this project to practice Git, here's a beginner-friendly
sequence of commits you can follow when building or modifying the project:

```bash
# 1. Initial scene
git add index.html
git commit -m "Initial scene: kawaii bakery room setup"

# 2. Bakery layout (shelves, counters, sink, oven)
git add index.html
git commit -m "Add bakery layout: shelves, counters, sink, oven"

# 3. Messy items added
git add index.html
git commit -m "Add messy items: croissants, pastries, bread, dishes, decorations"

# 4. Interaction system
git add js/components.js
git commit -m "Add interaction system: pickup and hover highlight"

# 5. Placement system
git add js/components.js js/game.js
git commit -m "Add placement system, progress tracking, and completion screen"

# Push everything to GitHub
git push origin main
```

---

## 🛠️ Customizing

- **Colors**: Most pastel colors are set directly on `material="color: ..."`
  attributes inside `index.html` — search for hex codes starting with `#ff`
  for the pink palette.
- **Adding more items**: Copy an existing `<a-entity class="interactable" ...>`
  block, give it a unique `id`, set `item-type` and `target-zone`, and update
  `totalItems` in `js/game.js`.
- **Sounds**: Add `<audio>` or A-Frame `sound` components inside
  `placeItemCorrectly()` in `js/game.js` for a "success" chime.

Enjoy organizing your kawaii bakery! 🌸🥐🍰
