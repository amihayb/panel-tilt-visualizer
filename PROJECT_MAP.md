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
5. **Detects edge drives** — reads ultrasonic sensors to determine whether the robot is traversing along the East or West edge of the panel row. Rows where the dominant sensor is stuck continuously on for too long are excluded.
6. **Finds panel boundaries** — sharp changes in pitch-per-meter signal a gap between panels, but **only within edge-drive rows** (`_edgeDrive ≠ 0`). The panel counter never advances for non-edge segments.
7. **Assigns panel numbers** to every valid (edge-drive) row in the CSV.
8. **Plots** multiple Plotly views (pitch and roll): mean angle vs panel number (scatter), schematic tilt-line chain, and a side-view of 3 representative panels' roll. All plots are split by **Edge-East / Edge-West** (not by direction).
9. **Computes panel stats** — walks rows in time order; each contiguous run of the same `_panel_no` is one occurrence; for each, finds centre X, raw/displayed mean pitch, displayed mean roll, and edge direction within ±10 cm of centre.
10. **Exports** an augmented CSV with `X_m`, `panel_number`, `EdgeDrive`, per-panel mean pitch/roll, and a separate panel-stats CSV (one row per occurrence).

There is **no build step**, no Node/npm. Open `index.html` via a local server (needed so `config.json` loads via `fetch`).

---

## File Tree

```
next-panel-tilt/
├── PROJECT_MAP.md       ← YOU ARE HERE — read first
├── config.json          ← Runtime configuration (thresholds, scale factors, biases)
├── index.html           ← Single-page app HTML shell (no inline JS logic)
├── images/
│   ├── nextpower-logo-white.svg      ← Brand logo for dark theme
│   ├── nextpower-logo-black.svg      ← Brand logo for light theme
│   └── nextpower-icon-1200x630.png   ← Open Graph social-preview image (og:image in index.html)
├── vendor/
│   ├── font-awesome.min.css      ← Font Awesome 4.7 icon font (webfonts served from CDN)
│   └── plotly.min.js             ← Plotly charting library (local copy; no internet needed)
├── css/
│   └── style.css        ← All styles + CSS design tokens (colors read by plots.js)
└── js/
    ├── config.js        ← Loads config.json → window.CFG; defines CFG_DEFAULTS
    ├── parser.js        ← CSV parsing, odometry, drive detection, edge drive, panel numbering, stats
    ├── exporter.js      ← Exports augmented CSV to the user's browser downloads
    ├── plots.js         ← All Plotly render functions (pitch, roll, side view)
    └── app.js           ← App wiring: DOM event listeners, pipeline orchestration
```

---

## File-by-File Reference

### `config.json`
Runtime configuration. Loaded at startup by `config.js`. All algorithms read values from `window.CFG`.

| Section | Purpose |
|---------|---------|
| `odometry` | `ticksPerMeter`, robot start position (`initialX`, `initialY`) |
| `signalScaleFactors` | Scale + offset for each CSV signal (Yaw, Pitch, Roll, encoders, ultrasonics) |
| `panels` | Physical panel width/gap (meters), encoder ticks per panel length, trim, and signed `startPanel` |
| `drives` | `startTolDeg` — how close to 0°/180° to start a new drive segment |
| `gaps` | `pitchDiffDegPerMeter` threshold, `stableMinLengthM`, `stableRatio` — gap detection params |
| `edgeDrive` | `maxContinuousSecs` (default `2`) — if the dominant ultrasonic sensor is continuously = 1 for longer than this, those rows are excluded from edge-drive detection (set to `_edgeDrive = 0`) |
| `display` | Plotly colors, marker sizes, line widths |
| `biasPitch` | Degrees subtracted from scaled pitch after load (`_pitch = _pitchRaw − biasPitch`). Default `1.1`. |
| `biasRoll` | Degrees subtracted from scaled roll after load (`_roll = _rollRaw − biasRoll`). Default `-1.7`. |

`_comment` keys are human documentation only — the code ignores them.

---

### `js/config.js`
**Defines `CFG_DEFAULTS`** (same structure as `config.json`, used as fallback).

**`loadConfig()`** — `async`, fetches `./config.json`, assigns `window.CFG`. On error falls back to `CFG_DEFAULTS`. Validates `biasPitch`, `biasRoll`, and `panels.startPanel`; replaces invalid values with defaults.

Must be loaded first (before `parser.js` and `plots.js`).

---

### `js/parser.js`
The core processing engine. Depends on `window.CFG`.

#### Functions (in call order):

**`parseCSV(text)`**
- Finds header row; returns `{ headers, rows }`. Each row has raw column values plus:
  - `_time_s` — seconds since start of day, relative to row 0.
  - `_pitchRaw` — pitch in degrees after scale factors only (before bias).
  - `_pitch` — `_pitchRaw − CFG.biasPitch`.
  - `_rollRaw` — roll in degrees after scale factors only (before bias).
  - `_roll` — `_rollRaw − CFG.biasRoll`.
  - `_yaw` — scaled using `CFG.signalScaleFactors`.
  - `_encR`, `_encL` — raw encoder values.

**`reapplyPitchBias(rows)`**
- Recomputes `_pitch` from `_pitchRaw` and current `CFG.biasPitch`. When `panelStats` are provided, also refreshes displayed pitch values and row `_panel_mean_pitch`. Does **not** re-run panel detection; panel boundaries and raw pitch stats use `_pitchRaw`.

**`_displayedPitchMean(meanPitch, dir)`** *(module-private helper)*
- Applies `CFG.biasPitch` and the direction sign convention once for displayed pitch (`0°` drives negated).

**`_displayedRollMean(meanRoll, dir)`** *(module-private helper)*
- Applies the direction sign convention once for displayed roll (`0°` drives negated).

**`_stampPanelMeanPitchRows(rows, panelStats)`** *(module-private helper)*
- Refreshes row-level `_panel_mean_pitch` from existing panel stats after Bias pitch changes.

**`reapplyRollBias(rows)`**
- Recomputes `_roll` from `_rollRaw` and current `CFG.biasRoll`. Called when the user edits **Bias roll**. Only recomputes panel stats and re-renders roll plots (no panel re-detection needed).

**`detectDriveSegments(rows)`**
- Groups rows into segments where heading is near **0°** or **180°** (±15° hysteresis, strict `CFG.drives.startTolDeg` to begin). Discards all data before the first 180° drive. Returns `{ seg0, seg180 }`.

**`computeOdometry(rows, qualifyingSegs?)`**
- Differential drive integration using encoder deltas ÷ `CFG.odometry.ticksPerMeter`, stepped along `_yaw`. Negative encoder deltas skipped (reset artifact). Attaches `rows.totalDistanceM`.

**`computeEdgeDrive(rows, seg0, seg180)`**
- Must run **before** `assignPanelNumbers`. Stamps `_edgeDrive` on every row in-place using absolute compass direction (0° = North, 180° = South):
  - `+1` = East-edge drive
  - `-1` = West-edge drive
  - `0`  = no edge drive, stuck-sensor row, or outside a qualifying drive
- Direction mapping: North + Right sensor predominates → East (+1); North + Left → West (−1); South + Right → West (−1); South + Left → East (+1).
- Per-segment majority vote (UltrasonicRight vs UltrasonicLeft raw counts > 0.5) determines direction for the whole segment; then a per-row validity pass (via `_stampEdgeSegment`) resets any row in a continuous "stuck" run (sensor = 1 without break for > `CFG.edgeDrive.maxContinuousSecs` seconds) back to 0.

**`_stampEdgeSegment(seg, dominantKey, edgeVal, maxSecs)`** *(module-private helper)*
- Stamps all rows in a segment with `edgeVal`, then walks through and resets rows that belong to a continuous "sensor stuck at 1" run longer than `maxSecs` back to 0.

**`assignPanelNumbers(rows, seg0, seg180)`**
- Merges drives in time order. **Requires `_edgeDrive` already set** (call `computeEdgeDrive` first).
- Skips entire segments where no row has `_edgeDrive ≠ 0` — the panel counter never advances for them.
- Within each qualifying segment, builds `activeDrive` (rows with `_edgeDrive ≠ 0`) and runs the pitch-gap hysteresis detector **only on those rows**, using raw `_pitchRaw` so bias changes do not affect panel boundaries. The panel counter only increments for panels detected in valid rows.
- Starts from signed integer `CFG.panels.startPanel`, then increments for 0° drives and decrements for 180° drives. Stamps `_panel_no` on matched rows (`null` for all other rows including stuck-sensor rows inside an otherwise-valid segment).

**`computePanelStats(rows)`**
- Scans all rows in time order; each contiguous `_panel_no` run is one occurrence.
- For each run: **centre X**, **dir** (0 or 180 from yaw at centre), raw **meanPitch** from `_pitchRaw`, mean **meanRoll** from bias-adjusted `_roll`, displayed **displayedMeanPitch** / **displayedMeanRoll** (with bias/sign applied once), and **edgeDrive** (majority vote of `_edgeDrive` across all rows in the run: `+1` East, `−1` West, `0` none). Also stamps `_panel_mean_pitch` / `_panel_mean_roll` on every row in that panel occurrence for telemetry export.
- Returns `Array<{ panel_no, dir, centerX, meanPitch, meanRoll, displayedMeanPitch, displayedMeanRoll, edgeDrive, windowRowCount }>` in time order.

**`updateStatsBar(rows)`**
- Writes row count, total distance, and time span into the stats bar elements.

---

### `js/exporter.js`

**`exportCSV(rows, headers)`** — Downloads `telemetry_with_panels.csv` (original columns + `X_m`, `panel_number`, `EdgeDrive`, `mean_pitch_deg`, `mean_roll_deg`). `panel_number` and mean angle columns are empty for rows outside qualifying edge drives or in stuck-sensor runs; `EdgeDrive` is `0`.

**`exportPanelStatsCSV(panelStats)`** — Downloads `panel_stats.csv` (one row per occurrence: `panel_number`, `direction_deg`, `center_x_m`, `mean_pitch_deg`, `mean_roll_deg`, `edge_drive`, `window_row_count`). Exported pitch/roll values use the same displayed direction sign convention as the plots.

No dependencies on `CFG`.

---

### `js/plots.js`
Depends on **Plotly** (CDN). Reads CSS design tokens via `getComputedStyle` for theme-aware colors.

#### Helpers

| Helper | Purpose |
|--------|---------|
| `_themeColors()` | Returns `{ paper, plot, grid, text, muted, primary }` from CSS variables |
| `plotPitchDeg(row)` | Raw pitch for the hidden legacy distance plot; no direction sign is applied here |
| `_formatPitchLabel(p)` | Compact numeric string for angle annotations |
| `_edgeFilterAllows(edgeFilter, edgeDrive)` | Shared predicate for the main edge visibility filter (`both`, `east`, `west`) |
| `_dedupeFirstPassPerPanel(stats, edgeDrive)` | First time-ordered occurrence per `panel_no` for a given `edgeDrive` value (1 or −1) |
| `_buildTiltChain(stats, edgeDrive, color)` | Connected polyline + annotations for the pitch tilt-lines chart (×10 exaggeration); filters by `edgeDrive` |
| `_buildTiltChainRoll(stats, edgeDrive, color)` | Same for the roll tilt-lines chart (×10 exaggeration); filters by `edgeDrive` |
| `_panelNumberXAxisRange(panelStats)` | Shared x-range (min panel_no − 0.5 … max + 0.5) for panel-number plots |

#### Render functions

| Function | Plot div | What it renders |
|----------|----------|-----------------|
| `renderPanelTiltLinesPlot(panelStats, edgeFilter)` | `#plot-panel-tilt-lines` | Connected pitch tilt chain — traces filtered by `edgeFilter` (`both`, `east`, `west`); angle × 10, labels |
| `renderPanelMeanPitchPlot(panelStats, edgeFilter)` | `#plot-panel-pitch` | Scatter: displayed mean pitch vs panel number — traces filtered by `edgeFilter`. Normal drives (`edgeDrive=0`) excluded. |
| `renderPanelRollLinesPlot(panelStats, edgeFilter)` | `#plot-panel-roll-lines` | Connected roll tilt chain — traces filtered by `edgeFilter`; angle × 10, labels |
| `renderPanelMeanRollPlot(panelStats, edgeFilter)` | `#plot-panel-roll` | Scatter: displayed mean roll vs panel number — traces filtered by `edgeFilter`. Normal drives excluded. |
| `renderPitchPlot(rows)` | `#plot-pitch` | Hidden. Gray background + per-panel colored traces, Y = raw pitch via `plotPitchDeg`, X = odometry |
| `renderSideViewPlot(panelStats, axis, sideViewEdge)` | `#plot-side-view` | **Roll only.** First, middle, and last panels from the selected edge group (`sideViewEdge`: 1 = East-edge, −1 = West-edge), sorted by `centerX`. Each panel is drawn with fixed geometry (`x: -1..1`) using an exaggerated angle (`roll*10`): `y = x * tan(roll*10°)`, with a constant Y-axis scale. Hidden when `axis === 'pitch'` via CSS. |

Colors: `PANEL_COLORS` (15-color palette) for per-panel traces; `COLOR_0 = '#3A8FC4'` (blue) for Edge-East / `COLOR_180 = '#D4523A'` (red) for Edge-West; side-view uses amber / blue / green for first / middle / last panels.

---

### `js/app.js`
App wiring layer. Loaded last (after all other JS modules). Contains a single async IIFE that:
- Calls `await loadConfig()` on startup.
- Queries all DOM elements once and stores them in `const` variables.
- Defines `handleFile`, `parseBiasInput`, `parseSignedIntegerInput`, `loadSavedTuningValues`, `saveTuningValue`, `applyStartPanelAndRefreshPlots`, `applyBiasAndRefreshPlots`, `applyRollBiasAndRefreshPlots`, `applyTheme`.
- Attaches all event listeners: file input, drag/drop, export buttons, bias inputs, theme toggle, resize handle, axis toggle, side-view edge toggle.
- Maintains module-level state: `loadedRows`, `loadedHeaders`, `loadedPanelStats`, `loadedSeg0`, `loadedSeg180`, `sideViewEdge` (1 = East, −1 = West; default 1).

No dependencies beyond `window.CFG` and the functions exported by the other JS files.

---

### `index.html`
Single-page application HTML shell. Contains no application logic — all JS lives in `js/`.

**UI style:** NextPower brand (Font Awesome 4.7, NextPower logo SVGs, CSS design tokens).

#### Key DOM elements

| Element | Purpose |
|---------|---------|
| `#file-input` | Hidden file input inside the folder-open topnav icon |
| `#export-btn` | Save icon; downloads augmented telemetry CSV |
| `#export-panel-btn` | Table icon; downloads panel stats CSV |
| `#axis-toggle` | Pitch / Roll pill toggle in topnav. Sets `data-axis` on `#plot-area`; CSS hides the inactive pair and the side view wrapper |
| `#edge-filter-toggle` | Both / East / West pill toggle in topnav. Filters the four main panel plots by edge trace; choosing East or West also switches the roll side-view edge to match. |
| `#theme-toggle` | Moon/sun icon; switches light/dark; persists in `localStorage` (`pt-theme`) |
| `#stats-bar` | Hidden until load; summary stats + start-panel and bias inputs |
| `#start-panel-input` | Signed integer input; edits `CFG.panels.startPanel`, persists to `localStorage` (`pt-start-panel`), then re-runs panel numbering → panel stats → all plots |
| `#bias-pitch-input` | Number input (step 0.1°); edits `CFG.biasPitch`, persists to `localStorage` (`pt-bias-pitch`), triggers `reapplyPitchBias` → pitch plots only |
| `#bias-roll-input` | Number input (step 0.1°); edits `CFG.biasRoll`, persists to `localStorage` (`pt-bias-roll`), triggers `reapplyRollBias` → panel stats → roll plots only |
| `#drop-zone` | Full-page drop target before file load |
| `#plot-area` | Flex-row container, `data-axis="pitch\|roll"`. Contains `.plot-column` + `#resize-handle` + `.side-view-wrapper` |
| `.plot-column` | Flex-column; holds the four toggled plot divs + hidden `#plot-pitch` |
| `#plot-panel-tilt-lines` | Pitch tilt-lines (visible when `data-axis="pitch"`) |
| `#plot-panel-pitch` | Pitch scatter (visible when `data-axis="pitch"`) |
| `#plot-panel-roll-lines` | Roll tilt-lines (visible when `data-axis="roll"`) |
| `#plot-panel-roll` | Roll scatter (visible when `data-axis="roll"`) |
| `#plot-pitch` | Always hidden (`display:none`) — kept for `renderPitchPlot` compatibility |
| `#resize-handle` | 5 px drag handle between `.plot-column` and `.side-view-wrapper`; resizes side view on mousedown/mousemove/mouseup; fires `window resize` on release so Plotly reflows |
| `.side-view-wrapper` | Flex-column container holding `#side-view-edge-toggle` and `#plot-side-view`; hidden via CSS when `data-axis="pitch"` |
| `#side-view-edge-toggle` | East / West pill toggle above the side-view plot; switches `sideViewEdge` in `app.js` and re-renders the side view |
| `#plot-side-view` | Side-view roll chart; fills width of `.side-view-wrapper` |

**Script load order:** `config.js` → `parser.js` → `exporter.js` → `plots.js` → `app.js`.

#### Main pipeline (`app.js`)

```
await loadConfig()
→ apply saved user tuning from localStorage:
    pt-start-panel, pt-bias-pitch, pt-bias-roll override config defaults
→ wire: file input, drag/drop, theme toggle, axis toggle, main edge filter,
         bias inputs, resize handle, side-view East/West edge toggle

→ on CSV load:
    parseCSV(text)
    detectDriveSegments(rows)
    computeOdometry(rows, allQualifyingSegs)
    computeEdgeDrive(rows, seg0, seg180)   ← must run before assignPanelNumbers
    assignPanelNumbers(rows, seg0, seg180) ← uses _edgeDrive; skips non-edge segments
    computePanelStats(rows)          → loadedPanelStats
    start-panel input ← CFG.panels.startPanel
    bias inputs ← CFG.biasPitch / CFG.biasRoll
    updateStatsBar(rows)
    renderPanelTiltLinesPlot / renderPanelMeanPitchPlot with edgePlotFilter
    renderPanelRollLinesPlot / renderPanelMeanRollPlot with edgePlotFilter
    renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis, sideViewEdge)
    renderPitchPlot(rows)            [hidden, kept for completeness]
    enable export buttons

→ on start-panel change:
    CFG.panels.startPanel ← signed integer input
    assignPanelNumbers; computePanelStats
    render all 4 active plots + side view

→ on bias pitch change:
    CFG.biasPitch ← input; reapplyPitchBias(rows)
    displayed pitch values are refreshed on existing panel stats
    render pitch plots only

→ on bias roll change:
    CFG.biasRoll ← input; reapplyRollBias(rows)
    computePanelStats
    renderPanelRollLinesPlot; renderPanelMeanRollPlot; renderSideViewPlot

→ on axis toggle (pitch ↔ roll):
    data-axis updated; CSS shows/hides correct plots
    re-render the 2 newly visible plots (Plotly needs real width after display change)
    renderSideViewPlot(loadedPanelStats, newAxis, sideViewEdge)

→ on main edge filter toggle (Both / East / West):
    edgePlotFilter updated; the four main panel plots are re-rendered with only the
    selected edge traces. Choosing East or West also updates sideViewEdge to match.

→ on side-view edge toggle (East ↔ West):
    sideViewEdge updated (1 or −1)
    renderSideViewPlot(loadedPanelStats, currentAxis, sideViewEdge)

→ on theme toggle:
    re-render all 4 active plots + side view (Plotly reads new CSS color variables)

→ on resize handle drag:
    mousedown: record startX, startWidth of .side-view-wrapper; lock cursor
    mousemove: sideViewEl.style.width = clamped(150…700 px)
    mouseup: release cursor; window.dispatchEvent('resize') → Plotly reflows
```

---

### `css/style.css`
All visual styles. Uses CSS custom properties identical to nextscope for brand consistency. `plots.js` reads these variables to theme Plotly charts.

Key variables: `--color-bg`, `--color-surface`, `--color-border`, `--color-primary`, `--color-secondary`, `--color-text-primary`, `--color-text-secondary`, `--gradient-brand`.

Light/dark via `data-theme="light"|"dark"` on `<html>`.

**Layout rules:**
- `.plot-area` — `display: flex; flex-direction: row` (column + handle + side-view-wrapper side-by-side).
- `.plot-column` — `flex: 1; flex-direction: column` (stacks the two active plots).
- `data-axis="pitch"` on `.plot-area` — hides roll plots and `.side-view-wrapper`.
- `data-axis="roll"` on `.plot-area` — hides pitch plots.
- `.resize-handle` — 5 px bar, `cursor: col-resize`; highlights brand-red on hover / drag.
- `.side-view-wrapper` — `flex: 0 0 auto; width: 300px` (initial; overridden by JS drag); flex-column containing the East/West toggle pill and `#plot-side-view`.
- `.side-view-toggle` — East/West pill toggle; uses `.axis-toggle` / `.axis-btn` styles (same as the Pitch/Roll pill).
- `#plot-side-view` — `width: 100%; height: 640px`.
- `.hidden` — utility class (`display: none !important`). Used on `#stats-bar` and `#plot-area` in their initial (pre-load) hidden state; removed by `app.js` after a CSV is loaded.

---

## Key Design Decisions

- **No build tooling** — pure vanilla JS + HTML. Any `.js` change is live on refresh.
- **`window.CFG` is the global config object** — all modules read from it. Never hardcode thresholds.
- **Odometry only during straight drives** — turns excluded from integration to avoid error accumulation.
- **Edge drive before panel detection** — `computeEdgeDrive` must run before `assignPanelNumbers`. Panel gaps are detected only in `activeDrive` rows (`_edgeDrive ≠ 0`) so the panel counter never advances for non-edge or stuck-sensor rows.
- **EdgeDrive uses absolute compass direction** — East/West derived from robot heading (North=0°, South=180°) combined with which ultrasonic sensor fires: North+Right and South+Left are East; North+Left and South+Right are West. Stuck sensor runs (> `CFG.edgeDrive.maxContinuousSecs` continuous) are excluded per-row.
- **Pitch/roll sign flip by direction, not edge** — `computePanelStats` applies the display sign once (`0°` drives are negated) into `displayedMeanPitch` / `displayedMeanRoll`; plots and CSV export reuse those fields. Pitch bias affects only displayed pitch values, not panel detection or raw pitch stats.
- **Plots split by Edge-East / Edge-West** — all panel plots (scatter and tilt-lines) show two traces by edge direction; normal drives (`edgeDrive=0`) are never plotted.
- **Roll bias does not trigger panel re-detection** — panel boundaries depend only on pitch; roll bias only affects roll stats and roll plots.
- **Side view only for roll** — pitch is already well-represented by the tilt-lines chart. Side view shows first, middle, and last panels from the selected edge group (East or West), switchable via the East/West toggle above the chart.
- **Plotly bundled locally** — `vendor/plotly.min.js` is served from disk; no internet required at runtime.

---

## Known Incomplete Features

| Feature | Status | Notes |
|---------|--------|-------|
| `normalizePanels` function | Not needed yet | Would be required if drive plots are reintroduced |
| Side view panel selection | First/middle/last from selected edge group | Could be made interactive (click on a panel in scatter chart) |

---

## Map Maintenance

Update this file when:
- A new file or module is added
- A struct or data type changes (e.g. new field in `panelStats` entries)
- Signal flow or control logic changes
- A new coding convention is established

---

## How to Run

1. Open the project folder in VS Code or any editor.
2. Start a simple local HTTP server in the project root, e.g. with the VS Code **Live Server** extension, or:
   ```
   python -m http.server 8080
   ```
3. Open `http://localhost:8080` in a browser.
4. Drag a telemetry CSV onto the drop zone, or click **Load CSV**.

> If you open `index.html` directly as a `file://` URL, `config.json` will fail to load and the app will fall back to built-in defaults (a warning appears in the browser console).
