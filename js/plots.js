// Plotly chart: Pitch vs distance traveled, colored by panel number.
// Colors are read from CSS variables so dark/light theme is always respected.

// Palette for panel segments (same set as nextscope for consistency)
const PANEL_COLORS = [
  '#D4523A', '#3A8FC4', '#3DB87A', '#7B4E8A', '#C47A10',
  '#C4566B', '#5A8F3A', '#3A5A8A', '#C4A020', '#8A3A7B',
  '#3AC4B8', '#A07B3A', '#3A7BA0', '#8AC43A', '#C43A8A'
];

function _themeColors() {
  const s = getComputedStyle(document.documentElement);
  return {
    paper: s.getPropertyValue('--color-bg').trim(),
    plot:  s.getPropertyValue('--color-surface').trim(),
    grid:  s.getPropertyValue('--color-border').trim(),
    text:  s.getPropertyValue('--color-text-primary').trim(),
    muted: s.getPropertyValue('--color-text-secondary').trim(),
    primary: s.getPropertyValue('--color-primary').trim()
  };
}

const _cfg = { responsive: true, displayModeBar: true, scrollZoom: true };

// Same loose yaw window as parser `detectDriveSegments` (±15° of 0 or 180°)
const _DRIVE_YAW_TOL_RAD = (15 * Math.PI) / 180;

/** 0 | 180 | null — null = turn / unclear */
function _classifyDriveYaw(yaw) {
  if (yaw == null || Number.isNaN(yaw)) return null;
  if (yaw <= _DRIVE_YAW_TOL_RAD || yaw >= 2 * Math.PI - _DRIVE_YAW_TOL_RAD) return 0;
  if (Math.abs(yaw - Math.PI) <= _DRIVE_YAW_TOL_RAD) return 180;
  return null;
}

/**
 * Pitch for plotting: 180° drive → -pitch (sensor sign vs travel direction).
 * Uses _panel_no sign when set; otherwise yaw classification.
 */
function plotPitchDeg(row) {
  const p = row._pitch;
  if (p == null || Number.isNaN(p)) return NaN;
  let dir180 = false;
  if (row._panel_no != null && row._panel_no !== undefined) {
    dir180 = row._panel_no < 0;
  } else {
    dir180 = _classifyDriveYaw(row._yaw) === 180;
  }
  return dir180 ? -p : p;
}

/** Shared x-axis limits for panel-number plots (scatter + tilt lines share the same zoom). */
function _panelNumberXAxisRange(panelStats) {
  if (!panelStats.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of panelStats) {
    const n = s.panel_no;
    if (typeof n !== 'number' || Number.isNaN(n)) continue;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  if (!Number.isFinite(lo)) return null;
  const pad = 0.5;
  return [lo - pad, hi + pad];
}

function _applyPanelNumberXAxis(layout, panelStats) {
  const xr = _panelNumberXAxisRange(panelStats);
  if (xr) {
    layout.xaxis.range = xr;
    layout.xaxis.autorange = false;
  }
}

// ─── Mean Pitch vs Panel Number ───────────────────────────────────────────
// panelStats is a time-ordered list of panel occurrences (one per contiguous
// run).  The same panel_no can appear multiple times.
// One trace per direction (0° and 180°), markers only (no connecting line)
// because the same panel_no can have multiple y values.

function renderPanelMeanPitchPlot(panelStats) {
  const c = _themeColors();
  const traces = [];

  const pass0   = panelStats.filter(s => s.dir === 0);
  const pass180 = panelStats.filter(s => s.dir === 180);

  if (pass0.length) {
    traces.push({
      x:    pass0.map(s => s.panel_no),
      y:    pass0.map(s => s.meanPitch),
      text: pass0.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: '0° pass',
      marker: { color: '#3A8FC4', size: 9, symbol: 'circle' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Mean pitch: %{y:.3f}°<extra></extra>'
    });
  }

  if (pass180.length) {
    traces.push({
      x:    pass180.map(s => s.panel_no),
      y:    pass180.map(s => -s.meanPitch),
      text: pass180.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: '180° pass',
      marker: { color: '#D4523A', size: 9, symbol: 'diamond' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Plot pitch (−mean): %{y:.3f}°<extra></extra>'
    });
  }

  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor:  c.plot,
    font: { family: 'Lato, sans-serif', color: c.text, size: 13 },
    margin: { t: 20, r: 20, b: 60, l: 70 },
    xaxis: {
      title: { text: 'Panel number', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted,
      dtick: 1,
      tickmode: 'linear'
    },
    yaxis: {
      title: { text: 'Displayed pitch (deg)', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted,
      zeroline: true,
      zerolinewidth: 1
    },
    legend: {
      font: { color: c.muted, size: 11 },
      bgcolor: 'transparent',
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: -0.18,
      yanchor: 'top'
    },
    hovermode: 'closest',
    showlegend: true
  };

  _applyPanelNumberXAxis(layout, panelStats);

  Plotly.react('plot-panel-pitch', traces, layout, _cfg);
}

// Mean displayed pitch (same sign rule as mean-pitch scatter)
function _displayedMeanPitch(s) {
  return s.dir === 180 ? -s.meanPitch : s.meanPitch;
}

function _formatPitchLabel(p) {
  const v = Math.round(p * 100) / 100;
  if (Math.abs(v) < 1e-8) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-4) return String(Math.round(v));
  return String(parseFloat(v.toFixed(2)));
}

// ─── Panel tilt lines (connected chain per direction) ─────────────────────
// Segments are connected: the right endpoint of panel N is the left endpoint
// of panel N+1, so the chain is one continuous polyline per direction.
// Line angle = displayed_pitch × 10° (clamped ±89°).
// Label above line for 0°, below for 180°; label color matches line.
const COLOR_0   = '#3A8FC4';
const COLOR_180 = '#D4523A';

/**
 * panelStats is time-ordered. If the same panel_no appears twice in one direction
 * (second pass), keep only the first occurrence so the polyline stays connected.
 */
function _dedupeFirstPassPerPanel(stats, dir) {
  const seen = new Set();
  const out = [];
  for (const s of stats) {
    if (s.dir !== dir) continue;
    if (seen.has(s.panel_no)) continue;
    seen.add(s.panel_no);
    out.push(s);
  }
  return out;
}

/**
 * Build a connected tilt chain for one direction.
 * Returns { x, y, annotations } ready for Plotly.
 *
 * Deduped first, then sorted spatially by centerX (left → right).
 * Each segment width = 1 unit (panel_no−0.5 … panel_no+0.5).
 * Start y of first segment = 0; subsequent segments inherit the previous end y.
 */
function _buildTiltChain(stats, dir, color) {
  const sorted = _dedupeFirstPassPerPanel(stats, dir).sort(
    (a, b) => a.centerX - b.centerX
  );

  if (!sorted.length) return { x: [], y: [], annotations: [] };

  const x = [];
  const y = [];
  const annotations = [];
  const LABEL_OFFSET = 0.15; // data units above/below the segment midpoint
  const above = dir === 0;

  let curY = 0;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const displayed = _displayedMeanPitch(s);
    const thetaDeg = Math.max(-89, Math.min(89, displayed * 10));
    const theta = (thetaDeg * Math.PI) / 180;

    // Each panel occupies exactly 1 x-unit → dy = tan(θ) × 1
    const xL = s.panel_no - 0.5;
    const xR = s.panel_no + 0.5;
    const yL = curY;
    const yR = curY + Math.tan(theta);

    if (i === 0) {
      x.push(xL);
      y.push(yL);
    }
    x.push(xR);
    y.push(yR);

    const yMid = (yL + yR) / 2;
    const textY = above ? yMid + LABEL_OFFSET : yMid - LABEL_OFFSET;

    annotations.push({
      x: s.panel_no,
      y: textY,
      text: _formatPitchLabel(displayed),
      showarrow: false,
      xref: 'x',
      yref: 'y',
      font: { color, size: 13, family: 'Lato, sans-serif' },
      xanchor: 'center',
      yanchor: above ? 'bottom' : 'top'
    });

    curY = yR;
  }

  return { x, y, annotations };
}

function renderPanelTiltLinesPlot(panelStats) {
  const c = _themeColors();

  const chain0   = _buildTiltChain(panelStats, 0,   COLOR_0);
  const chain180 = _buildTiltChain(panelStats, 180, COLOR_180);

  const traces = [];

  if (chain0.x.length) {
    traces.push({
      x: chain0.x,
      y: chain0.y,
      type: 'scatter',
      mode: 'lines',
      name: '0° pass',
      line: { color: COLOR_0, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (chain180.x.length) {
    traces.push({
      x: chain180.x,
      y: chain180.y,
      type: 'scatter',
      mode: 'lines',
      name: '180° pass',
      line: { color: COLOR_180, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (!traces.length) {
    traces.push({ x: [], y: [], type: 'scatter', mode: 'lines', showlegend: false });
  }

  const annotations = [...chain0.annotations, ...chain180.annotations];

  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor: c.plot,
    font: { family: 'Lato, sans-serif', color: c.text, size: 13 },
    margin: { t: 20, r: 20, b: 60, l: 70 },
    xaxis: {
      title: { text: 'Panel number', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted,
      dtick: 1,
      tickmode: 'linear'
    },
    yaxis: {
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted,
      zeroline: true,
      showticklabels: false
    },
    annotations,
    legend: {
      font: { color: c.muted, size: 11 },
      bgcolor: 'transparent',
      orientation: 'h',
      x: 0,
      xanchor: 'left',
      y: -0.18,
      yanchor: 'top'
    },
    hovermode: false,
    showlegend: Boolean(chain0.x.length || chain180.x.length)
  };

  _applyPanelNumberXAxis(layout, panelStats);

  Plotly.react('plot-panel-tilt-lines', traces, layout, _cfg);
}

// ─── Pitch vs Distance ────────────────────────────────────────────────────
// One trace per panel number so each panel gets its own color and legend entry.
// Rows with _panel_no === null (outside qualifying drives) are shown as a thin
// gray background trace so the distance axis is continuous.

function renderPitchPlot(rows) {
  const c = _themeColors();
  const traces = [];

  // ── Background trace: all rows (thin, muted) ──────────────────────────
  traces.push({
    x: rows.map(r => r._x),
    y: rows.map(plotPitchDeg),
    type: 'scatter',
    mode: 'lines',
    line: { color: c.grid, width: 1 },
    hoverinfo: 'skip',
    showlegend: false,
    name: 'all'
  });

  // ── Collect unique panel numbers ───────────────────────────────────────
  const panelNums = [...new Set(
    rows.map(r => r._panel_no).filter(n => n !== null && n !== undefined)
  )].sort((a, b) => a - b);

  // ── One trace per panel ────────────────────────────────────────────────
  panelNums.forEach((pn, i) => {
    const panelRows = rows.filter(r => r._panel_no === pn);
    const color = PANEL_COLORS[Math.abs(pn) % PANEL_COLORS.length];
    const label = pn > 0 ? `Panel ${pn} (0°)` : `Panel ${Math.abs(pn)} (180°)`;

    traces.push({
      x: panelRows.map(r => r._x),
      y: panelRows.map(plotPitchDeg),
      text: panelRows.map(r => `T: ${r._time_s.toFixed(2)} s`),
      type: 'scatter',
      mode: 'lines+markers',
      line:   { color, width: 2 },
      marker: { color, size: 4 },
      name: label,
      legendgroup: label,
      hovertemplate:
        `<b>${label}</b><br>` +
        `Distance: %{x:.3f} m<br>` +
        `Pitch (plot): %{y:.2f}°<br>` +
        `%{text}<extra></extra>`
    });
  });

  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor:  c.plot,
    font: { family: 'Lato, sans-serif', color: c.text, size: 13 },
    margin: { t: 20, r: 20, b: 60, l: 70 },
    xaxis: {
      title: { text: 'Distance traveled (m)', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted
    },
    yaxis: {
      title: { text: 'Displayed pitch (deg)', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      color: c.muted,
      zeroline: true,
      zerolinewidth: 1
    },
    legend: {
      font: { color: c.muted, size: 11 },
      bgcolor: 'transparent',
      orientation: 'v',
      x: 1.01,
      xanchor: 'left',
      y: 1,
      yanchor: 'top'
    },
    hovermode: 'closest',
    showlegend: true
  };

  Plotly.react('plot-pitch', traces, layout, _cfg);
}
