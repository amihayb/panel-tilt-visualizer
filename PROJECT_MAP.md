# PROJECT MAP — Panel Tilt (next-panel-tilt)

> **Every AI agent must read this file before making any changes.**
> It describes what the project is, how it is structured, and how every file relates to the others.

---

## What This Project Does

**Panel Tilt** is a browser-only web tool for analyzing robot telemetry from Nextracker solar-panel inspection robots.

A robot drives along rows of solar panels, recording IMU angles (yaw/pitch/roll) and wheel encoder counts into a CSV log file. This tool:

1. **Loads** the CSV in the browser (no server needed at runtime).
2. **Parses** timestamps, angles, and encoder pulses.
3. **Detects straight drives** — segments where the robot heads at ~0° or ~180°.
4. **Computes a 2D path** (odometry) using encoders + yaw, but only during straight drives.
5. **Finds panel boundaries** — sharp changes in pitch-per-meter signal a gap between panels.
6. **Assigns panel numbers** to every row in the CSV.
7. **Plots** multiple Plotly views: displayed pitch vs odometry X (per panel), mean pitch vs panel number (by occurrence), and a schematic “tilt line” chain per direction.
8. **Computes panel stats** — walks rows in time order; each contiguous run of the same `_panel_no` is one occurrence; for each, finds centre X and mean pitch within ±10 cm of centre.
9. **Exports** an augmented CSV with `X_m` and `panel_number`, and a separate panel-stats CSV (one row per occurrence).

There is **no build step**, no Node/npm. Open `index.html` via a local server (needed so `config.json` loads via `fetch`).

---

## File Tree

```
next-panel-tilt/
├── PROJECT_MAP.md       ← YOU ARE HERE — read first
├── config.json          ← Runtime configuration (thresholds, scale factors, colors)
├── index.html           ← Single-page app entry point + wiring script
├── images/
│   ├── nextpower-logo-white.svg  ← Brand logo for dark theme (from nextscope)
│   ├── nextpower-logo-black.svg  ← Brand logo for light theme (from nextscope)
│   └── logo-title.svg            ← Nextscope title logo (right end of navbar)
├── vendor/
│   └── font-awesome.min.css      ← Font Awesome 4.7 icon font (from nextscope)
├── fonts/                        ← Font Awesome webfont files (from nextscope)
├── css/
│   └── style.css        ← All styles + CSS design tokens (colors read by plots.js)
└── js/
    ├── config.js        ← Loads config.json → window.CFG; defines CFG_DEFAULTS
    ├── parser.js        ← CSV parsing, odometry, drive detection, panel numbering
    ├── exporter.js      ← Exports augmented CSV to the user's browser downloads
    └── plots.js         ← Plotly: pitch vs X, mean pitch vs panel, tilt-line schematic; `plotPitchDeg`
```

---

## File-by-File Reference

### `config.json`
Runtime configuration. Loaded at startup by `config.js`. All algorithms read values from `window.CFG` (never hardcode thresholds in JS).

Key sections:
| Section | Purpose |
|---------|---------|
| `odometry` | `ticksPerMeter`, robot start position (`initialX`, `initialY`) |
| `signalScaleFactors` | Scale + offset for each CSV signal (Yaw, Pitch, Roll, encoders, ultrasonics) |
| `panels` | Physical panel width/gap (meters), encoder ticks per panel length, trim |
| `drives` | `startTolDeg` — how close to 0°/180° to start a new drive segment |
| `gaps` | `pitchDiffDegPerMeter` threshold, `stableMinLengthM`, `stableRatio` — gap detection params |
| `display` | Plotly colors, marker sizes, line widths |
| `biasPitch` | Degrees subtracted from scaled pitch after load (`_pitch = _pitchRaw - biasPitch`) |

`_comment` keys in the JSON are for human documentation only — the code ignores them.

---

### `js/config.js`
**Defines `CFG_DEFAULTS`** (same structure as `config.json`, used as fallback).

**`loadConfig()`** — `async` function, fetches `./config.json`, assigns `window.CFG`. On any network/fetch error (e.g. opened as `file://`), falls back to `CFG_DEFAULTS` and logs a warning. If `biasPitch` is missing or invalid in the merged config, it is set from `CFG_DEFAULTS.biasPitch` (default `0.7`).

Must be loaded first (before `parser.js` and `plots.js`).

---

### `js/parser.js`
The core processing engine. Depends on `window.CFG`.

#### Functions (in call order):

**`parseCSV(text)`**
- Finds the header row: first row in the first 20 lines that has >2 fields and a non-numeric second column.
- Returns `{ headers, rows }`. Each row object has raw column values plus:
  - `_time_s` — seconds since start of day, relative to row 0.
  - `_pitchRaw` — pitch in degrees after scale factors only (before bias).
  - `_pitch` — `_pitchRaw - CFG.biasPitch` (used for gap detection, plots, panel stats).
  - `_yaw`, `_roll` — scaled using `CFG.signalScaleFactors`.
  - `_encR`, `_encL` — raw encoder column values.

**`reapplyPitchBias(rows)`**
- Recomputes `_pitch` from `_pitchRaw` and current `CFG.biasPitch`. Used when the user edits **Bias pitch** in the stats bar.


**`detectDriveSegments(rows)`**
- Groups rows into segments where heading is near **0°** or **180°** (±15° hysteresis, strict `CFG.drives.startTolDeg` to begin a segment).
- **Discards all data before the first 180° drive** (robot calibration / homing pass).
- Returns `{ seg0, seg180 }` — arrays of row-arrays.

**`computeOdometry(rows, qualifyingSegs?)`**
- Differential drive integration: average wheel distance from encoder deltas ÷ `CFG.odometry.ticksPerMeter`, stepped along `_yaw` (clockwise-positive, Z-down convention).
- Negative encoder deltas are skipped (encoder reset artifact).
- If `qualifyingSegs` provided, only those rows advance position; other rows carry the last known `(_x, _y)`.
- Attaches `rows.totalDistanceM`.

**`assignPanelNumbers(rows, seg0, seg180)`**
- Merges drives in time order.
- Uses pitch-change-per-meter vs `CFG.gaps` thresholds with hysteresis ("gap mode" / stable-run logic) to split each drive into panels.
- Filters out very short interior panels.
- Stamps `_panel_no` on every row (positive for 0° passes, negative for 180°).
- Rows outside qualifying drives get `_panel_no = null`.

**`computePanelStats(rows)`**
- Scans **all rows in time order**. Whenever `_panel_no` stays constant across consecutive rows, those rows form one **occurrence** (a run). `null` `_panel_no` or a change in panel number ends the run.
- The same `panel_no` can appear **multiple times** (multiple runs), e.g. revisits or direction changes.
- For each run: **centre X** = `(min_x + max_x) / 2`; **dir** = `0` or `180` from the yaw of the row **closest to centre X** (within ±90° of 0 rad → 0°, else 180°); **meanPitch** = mean of `_pitch` for rows within **±10 cm** of centre (falls back to the whole run if none).
- Returns `Array<{ panel_no, dir, centerX, meanPitch, windowRowCount }>` in **time order** (not sorted by `panel_no`).

**`updateStatsBar(rows)`**
- Writes row count, total odometry distance, and time span into `#stat-rows`, `#stat-distance`, and `#stat-timespan`.

---

### `js/exporter.js`

**`exportCSV(rows, headers)`**
- Builds a CSV with original headers plus two new columns: `X_m` and `panel_number`.
- Replaces the `Time` column values with `row._time_s` (3 decimal places).
- Triggers a browser download as `telemetry_with_panels.csv`.

**`exportPanelStatsCSV(panelStats)`**
- Takes the array returned by `computePanelStats` (one row per **occurrence**).
- Downloads `panel_stats.csv` with columns: `panel_number`, `direction_deg`, `center_x_m`, `mean_pitch_deg`, `window_row_count`.
- `panel_number` is the signed `panel_no` as assigned by `assignPanelNumbers`. `direction_deg` is derived from yaw at the panel centre (see `computePanelStats`).

No dependencies on `CFG`.

---

### `js/plots.js`
Depends on **Plotly** (loaded from CDN in `index.html`). Reads CSS design tokens from `style.css`.

**Displayed pitch:** raw `_pitch` is biased in the parser (`_pitchRaw - CFG.biasPitch`). For **plots**, `plotPitchDeg(row)` negates pitch when `_panel_no < 0`, else uses yaw classification (±15° of 0° or 180°) when `_panel_no` is unset — so legend labels “0° / 180°” reflect the assignment convention, while panel-number plots split series by **`computePanelStats` `dir`** (from yaw at centre).

| Function | Plot div | What it renders |
|----------|----------|-----------------|
| `renderPanelTiltLinesPlot(panelStats)` | `#plot-panel-tilt-lines` | Connected polylines per direction (`dir` 0 vs 180). Duplicate `panel_no` in the same direction: **first** time-ordered occurrence only. Sorted by `centerX`. Segment angle from **displayed** mean pitch × 10° (clamp ±89°). Shared x-axis range with `#plot-panel-pitch`. |
| `renderPanelMeanPitchPlot(panelStats)` | `#plot-panel-pitch` | Markers only (same `panel_no` can repeat). Two traces by `dir`; 180° uses **−meanPitch** on Y vs 0° series. |
| `renderPitchPlot(rows)` | `#plot-pitch` | Gray background line (all rows), then one colored trace per `_panel_no`; Y = `plotPitchDeg(row)`. X = `_x` (odometry). |

Colors for per-panel traces: `PANEL_COLORS`; tilt lines use fixed blue/red for 0°/180°.

---

### `index.html`
Single-page application. No framework. All wiring is in an inline `<script>` at the bottom.

**UI style:** matches nextscope (NextPower brand). Uses Font Awesome 4.7 icons (local `vendor/font-awesome.min.css` + `fonts/`), NextPower logo SVGs, and the `logo-title.svg` title image on the right of the navbar.

Key DOM elements:

| Element ID | Purpose |
|------------|---------|
| `#file-input` | Hidden `<input type="file">` inside the folder-open icon in the topnav |
| `#export-btn` | Topnav save icon; downloads full telemetry CSV; disabled until data loaded |
| `#export-panel-btn` | Topnav table icon; downloads panel stats CSV; disabled until data loaded |
| `#theme-toggle` | Moon/sun icon button; switches light/dark; persists in `localStorage` key `pt-theme` |
| `#stats-bar` | Hidden until load; summary stats + `#bias-pitch-input` |
| `#bias-pitch-input` | Number input; edits `CFG.biasPitch`, triggers `reapplyPitchBias` → `assignPanelNumbers` → recomputed panel stats & both plots |
| `#drop-zone` | Full-page drop target shown before any file is loaded |
| `#plot-area` | Flex column (top → bottom): `#plot-panel-tilt-lines`, `#plot-panel-pitch`, `#plot-pitch`; hidden until load |

**Script load order:** `config.js` → `parser.js` → `exporter.js` → `plots.js` → inline IIFE.

**Main pipeline (inline IIFE):**
```
await loadConfig()
→ wire file input + drag/drop + theme toggle + bias input
→ on CSV load:
    parseCSV(text)
    detectDriveSegments(rows)
    computeOdometry(rows, allQualifyingSegs)
    assignPanelNumbers(rows, seg0, seg180)
    computePanelStats(rows)      → loadedPanelStats
    bias pitch input ← CFG.biasPitch (from loaded config)
    updateStatsBar(rows)
    renderPanelTiltLinesPlot(loadedPanelStats)
    renderPanelMeanPitchPlot(loadedPanelStats)
    renderPitchPlot(rows)
    enable #export-btn, #export-panel-btn

→ on bias input change (with data loaded):
    CFG.biasPitch ← input; reapplyPitchBias(rows)
    assignPanelNumbers(rows, seg0, seg180)
    computePanelStats(rows); renderPanelTiltLinesPlot; renderPanelMeanPitchPlot; renderPitchPlot
```

---

### `css/style.css`
All visual styles. Uses CSS custom properties (variables) identical to nextscope for brand consistency. `plots.js` reads these variables to theme Plotly charts.

Key variables: `--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-secondary`, `--color-text-primary`, `--color-text-secondary`, `--gradient-brand`.

Light/dark mode is controlled by `data-theme="light"` or `data-theme="dark"` on the `<html>` element.

---

## Key Design Decisions

- **No build tooling** — pure vanilla JS + HTML. Any change to a `.js` file is live immediately on refresh.
- **`window.CFG` is the global config object** — all modules read from it. Never hardcode numeric thresholds.
- **Odometry only during straight drives** — turns are excluded from integration to avoid error accumulation.
- **Panel detection is pitch-based** — physical gaps between panels cause a detectable spike in pitch change per meter traveled.
- **Plotly from CDN** — requires internet or a local copy if offline.

---

## Known Incomplete Features

| Feature | Status | Notes |
|---------|--------|-------|
| `normalizePanels` function | Not needed yet | Would be required if drive plots are reintroduced |

---

## Map Maintenance

This file must be kept current. Update it when:
- A new file or module is added
- A struct or data type changes
- Signal flow or control logic changes
- A refactoring from Section 13 is completed
- A new coding convention is established

---

## How to Run

1. Open the project folder in VS Code or any editor.
2. Start a simple local HTTP server in the project root, for example with the VS Code **Live Server** extension, or in the terminal:
   ```
   python -m http.server 8080
   ```
3. Open `http://localhost:8080` in a browser.
4. Drag a telemetry CSV onto the drop zone, or click **Load CSV**.

> If you open `index.html` directly as a `file://` URL, `config.json` will fail to load and the app will fall back to built-in defaults (a warning appears in the browser console).
