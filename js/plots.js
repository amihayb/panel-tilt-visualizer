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

// Exponential moving average: y_k = (1-α)·y_{k-1} + α·x_k
// Returns the original array unchanged when alpha is null/undefined.
function _emaSmooth(values, alpha) {
  if (alpha == null || !values.length) return values;
  const out = [values[0]];
  for (let k = 1; k < values.length; k++) {
    out.push((1 - alpha) * out[k - 1] + alpha * values[k]);
  }
  return out;
}

/**
 * Raw pitch for the hidden legacy distance plot.
 * Visible panel plots use `displayedMeanPitch` from `computePanelStats`.
 */
function plotPitchDeg(row) {
  const p = row._pitch;
  return p == null || Number.isNaN(p) ? NaN : p;
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

function _edgeFilterAllows(edgeFilter, edgeDrive) {
  if (edgeFilter === 'east') return edgeDrive === 1;
  if (edgeFilter === 'west') return edgeDrive === -1;
  return true;
}

// ─── Mean Pitch vs Panel Number ───────────────────────────────────────────
// panelStats is a time-ordered list of panel occurrences (one per contiguous
// run).  The same panel_no can appear multiple times.
// One trace per direction (0° and 180°), markers only (no connecting line)
// because the same panel_no can have multiple y values.

function renderPanelMeanPitchPlot(panelStats, edgeFilter = 'both') {
  const c = _themeColors();
  const traces = [];

  const visibleStats = panelStats.filter(s => _edgeFilterAllows(edgeFilter, s.edgeDrive));
  const eastEdge = visibleStats.filter(s => s.edgeDrive === 1);
  const westEdge = visibleStats.filter(s => s.edgeDrive === -1);

  if (eastEdge.length) {
    traces.push({
      x:    eastEdge.map(s => s.panel_no),
      y:    eastEdge.map(s => s.displayedMeanPitch),
      text: eastEdge.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: 'Edge-East',
      marker: { color: COLOR_0, size: 9, symbol: 'circle' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Mean pitch: %{y:.3f}°<extra></extra>'
    });
  }

  if (westEdge.length) {
    traces.push({
      x:    westEdge.map(s => s.panel_no),
      y:    westEdge.map(s => s.displayedMeanPitch),
      text: westEdge.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: 'Edge-West',
      marker: { color: COLOR_180, size: 9, symbol: 'diamond' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Mean pitch: %{y:.3f}°<extra></extra>'
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

  _applyPanelNumberXAxis(layout, visibleStats);

  Plotly.react('plot-panel-pitch', traces, layout, _cfg);
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
 * panelStats is time-ordered. Keep only the first occurrence of each panel_no
 * within the given edgeDrive group, so the polyline stays connected.
 */
function _dedupeFirstPassPerPanel(stats, edgeDrive) {
  const seen = new Set();
  const out = [];
  for (const s of stats) {
    if (s.edgeDrive !== edgeDrive) continue;
    if (seen.has(s.panel_no)) {
      continue;
    }
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
function _buildTiltChain(stats, edgeDrive, color, alpha = null) {
  const sorted = _dedupeFirstPassPerPanel(stats, edgeDrive).sort(
    (a, b) => a.centerX - b.centerX
  );

  if (!sorted.length) return { x: [], y: [], annotations: [] };

  const smoothed = _emaSmooth(sorted.map(s => s.displayedMeanPitch), alpha);

  const x = [];
  const y = [];
  const annotations = [];
  const LABEL_OFFSET = 0.15;
  const above = edgeDrive === 1; // East-edge labels above, West-edge below

  let curY = 0;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const displayed = smoothed[i]; // smoothed (or original when alpha=null)
    const thetaDeg = Math.max(-89, Math.min(89, displayed * 10));
    const theta = (thetaDeg * Math.PI) / 180;

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

function renderPanelTiltLinesPlot(panelStats, edgeFilter = 'both', alpha = null) {
  const c = _themeColors();
  const visibleStats = panelStats.filter(s => _edgeFilterAllows(edgeFilter, s.edgeDrive));

  const chainRight = _buildTiltChain(visibleStats,  1, COLOR_0,   alpha);
  const chainLeft  = _buildTiltChain(visibleStats, -1, COLOR_180, alpha);

  const traces = [];

  if (chainRight.x.length) {
    traces.push({
      x: chainRight.x,
      y: chainRight.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Edge-East',
      line: { color: COLOR_0, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (chainLeft.x.length) {
    traces.push({
      x: chainLeft.x,
      y: chainLeft.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Edge-West',
      line: { color: COLOR_180, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (!traces.length) {
    traces.push({ x: [], y: [], type: 'scatter', mode: 'lines', showlegend: false });
  }

  const annotations = [...chainRight.annotations, ...chainLeft.annotations];

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
    showlegend: Boolean(chainRight.x.length || chainLeft.x.length)
  };

  _applyPanelNumberXAxis(layout, visibleStats);

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
    const label = `Panel ${pn}`;

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

// ─── Mean Roll vs Panel Number ─────────────────────────────────────────────

function renderPanelMeanRollPlot(panelStats, edgeFilter = 'both') {
  const c = _themeColors();
  const traces = [];

  const visibleStats = panelStats.filter(s => _edgeFilterAllows(edgeFilter, s.edgeDrive));
  const eastEdge = visibleStats.filter(s => s.edgeDrive === 1);
  const westEdge = visibleStats.filter(s => s.edgeDrive === -1);

  if (eastEdge.length) {
    traces.push({
      x:    eastEdge.map(s => s.panel_no),
      y:    eastEdge.map(s => s.displayedMeanRoll),
      text: eastEdge.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: 'Edge-East',
      marker: { color: COLOR_0, size: 9, symbol: 'circle' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Mean roll: %{y:.3f}°<extra></extra>'
    });
  }

  if (westEdge.length) {
    traces.push({
      x:    westEdge.map(s => s.panel_no),
      y:    westEdge.map(s => s.displayedMeanRoll),
      text: westEdge.map(s =>
        `Panel ${s.panel_no}<br>` +
        `Centre X: ${s.centerX.toFixed(2)} m<br>` +
        `Rows in window: ${s.windowRowCount}`
      ),
      type: 'scatter',
      mode: 'markers',
      name: 'Edge-West',
      marker: { color: COLOR_180, size: 9, symbol: 'diamond' },
      hovertemplate:
        '<b>%{text}</b><br>' +
        'Mean roll: %{y:.3f}°<extra></extra>'
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
      title: { text: 'Displayed roll (deg)', font: { color: c.muted, size: 12 } },
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

  _applyPanelNumberXAxis(layout, visibleStats);

  Plotly.react('plot-panel-roll', traces, layout, _cfg);
}

// ─── Panel roll tilt lines (connected chain per direction) ─────────────────

function renderPanelRollLinesPlot(panelStats, edgeFilter = 'both', alpha = null) {
  const c = _themeColors();
  const visibleStats = panelStats.filter(s => _edgeFilterAllows(edgeFilter, s.edgeDrive));

  const chainRight = _buildTiltChainRoll(visibleStats,  1, COLOR_0,   alpha);
  const chainLeft  = _buildTiltChainRoll(visibleStats, -1, COLOR_180, alpha);

  const traces = [];

  if (chainRight.x.length) {
    traces.push({
      x: chainRight.x,
      y: chainRight.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Edge-East',
      line: { color: COLOR_0, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (chainLeft.x.length) {
    traces.push({
      x: chainLeft.x,
      y: chainLeft.y,
      type: 'scatter',
      mode: 'lines',
      name: 'Edge-West',
      line: { color: COLOR_180, width: 3 },
      hoverinfo: 'skip'
    });
  }

  if (!traces.length) {
    traces.push({ x: [], y: [], type: 'scatter', mode: 'lines', showlegend: false });
  }

  const annotations = [...chainRight.annotations, ...chainLeft.annotations];

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
    showlegend: Boolean(chainRight.x.length || chainLeft.x.length)
  };

  _applyPanelNumberXAxis(layout, visibleStats);

  Plotly.react('plot-panel-roll-lines', traces, layout, _cfg);
}

// ─── Side view — Roll only, 0° pass, 3 centre panels ──────────────────────
// Each panel is drawn as a line from x = -1 to +1, crossing (0, 0), where
// y = x * tan(roll*10°). This preserves a constant geometric scale and shows
// the side-view line at the exaggerated roll angle used by the tilt charts.
// Only shown when axis === 'roll'; hidden via CSS for pitch.

function renderSideViewPlot(panelStats, axis, sideViewEdge = 1) {
  const c = _themeColors();

  if (axis !== 'roll' || !panelStats.length) {
    Plotly.react('plot-side-view', [], { paper_bgcolor: c.paper, plot_bgcolor: c.plot }, _cfg);
    return;
  }

  const edgeLabel  = sideViewEdge === 1 ? 'Edge-East' : 'Edge-West';
  const sortedEdge = _dedupeFirstPassPerPanel(panelStats, sideViewEdge).sort((a, b) => a.centerX - b.centerX);
  if (!sortedEdge.length) {
    Plotly.react('plot-side-view', [], { paper_bgcolor: c.paper, plot_bgcolor: c.plot }, _cfg);
    return;
  }

  // First, middle, and last panels from the selected edge chain
  const n      = sortedEdge.length;
  const midIdx = Math.floor(n / 2);
  const panels = n === 1
    ? [sortedEdge[0]]
    : n === 2
      ? [sortedEdge[0], sortedEdge[1]]
      : [sortedEdge[0], sortedEdge[midIdx], sortedEdge[n - 1]];

  const LINE_COLORS = ['#C47A10', '#3A8FC4', '#3DB87A'];
  const POS_LABELS  = ['Left', 'Centre', 'Right'];

  const SIDE_X_HALF_SPAN = 1;
  const ROLL_EXAGGERATION = 10;
  const MAX_EXAGGERATED_DEG = 60;
  const Y_HALF_RANGE = Math.tan((MAX_EXAGGERATED_DEG * Math.PI) / 180);

  // Dotted zero reference
  const traces = [{
    x: [-SIDE_X_HALF_SPAN, SIDE_X_HALF_SPAN], y: [0, 0],
    type: 'scatter', mode: 'lines',
    line: { color: c.grid, width: 1, dash: 'dot' },
    showlegend: false, hoverinfo: 'skip'
  }];

  panels.forEach((s, i) => {
    const roll  = s.displayedMeanRoll;
    const exaggeratedDeg = Math.max(
      -MAX_EXAGGERATED_DEG,
      Math.min(MAX_EXAGGERATED_DEG, roll * ROLL_EXAGGERATION)
    );
    const slope = Math.tan((exaggeratedDeg * Math.PI) / 180);
    const color = LINE_COLORS[i % LINE_COLORS.length];
    const label = `${POS_LABELS[i] || 'Panel'} ${s.panel_no} (${_formatPitchLabel(roll)}°)`;
    traces.push({
      x: [-SIDE_X_HALF_SPAN, 0, SIDE_X_HALF_SPAN],
      y: [-slope * SIDE_X_HALF_SPAN, 0, slope * SIDE_X_HALF_SPAN],
      type: 'scatter', mode: 'lines',
      name: label,
      line: { color, width: 3 },
      hovertemplate: `<b>${label}</b><extra></extra>`
    });
  });

  const layout = {
    paper_bgcolor: c.paper,
    plot_bgcolor:  c.plot,
    font: { family: 'Lato, sans-serif', color: c.text, size: 13 },
    margin: { t: 36, r: 16, b: 70, l: 50 },
    title: {
      text: `Side view — Roll (${edgeLabel})`,
      font: { color: c.muted, size: 12 },
      x: 0.5, xanchor: 'center'
    },
    xaxis: {
      range: [-SIDE_X_HALF_SPAN, SIDE_X_HALF_SPAN],
      gridcolor: c.grid, zerolinecolor: c.grid, zerolinewidth: 2,
      color: c.muted,
      tickvals:  [-1, 0, 1],
      ticktext:  ['Left edge', 'Centre', 'Right edge'],
      tickmode: 'array'
    },
    yaxis: {
      title: { text: 'Slope', font: { color: c.muted, size: 12 } },
      gridcolor: c.grid, zerolinecolor: c.grid, zerolinewidth: 2,
      color: c.muted, zeroline: true,
      showticklabels: false,
      ticks: '',
      range: [-Y_HALF_RANGE, Y_HALF_RANGE]
    },
    legend: {
      font: { color: c.muted, size: 11 },
      bgcolor: 'transparent',
      orientation: 'h',
      x: 0, xanchor: 'left',
      y: -0.22, yanchor: 'top'
    },
    hovermode: 'closest',
    showlegend: true
  };

  Plotly.react('plot-side-view', traces, layout, _cfg);
}

function _buildTiltChainRoll(stats, edgeDrive, color, alpha = null) {
  const sorted = _dedupeFirstPassPerPanel(stats, edgeDrive).sort(
    (a, b) => a.centerX - b.centerX
  );

  if (!sorted.length) return { x: [], y: [], annotations: [] };

  const smoothed = _emaSmooth(sorted.map(s => s.displayedMeanRoll), alpha);

  const x = [];
  const y = [];
  const annotations = [];
  const LABEL_OFFSET = 0.15;
  const above = edgeDrive === 1; // East-edge labels above, West-edge below

  let curY = 0;

  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const displayed = smoothed[i]; // smoothed (or original when alpha=null)
    const thetaDeg = Math.max(-89, Math.min(89, displayed * 10));
    const theta = (thetaDeg * Math.PI) / 180;

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
