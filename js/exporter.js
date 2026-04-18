// Appends X_m and panel_number columns to the original rows and triggers a download.
// Time column is replaced with relative seconds (first row = 0).
// panel_number is empty for rows outside qualifying drives or in gaps.

function exportCSV(rows, headers) {
  const newHeaders = [...headers, 'X_m', 'panel_number'];
  const lines = [newHeaders.join(',')];

  for (const row of rows) {
    const vals = headers.map(h => {
      if (h === 'Time') return row._time_s.toFixed(3);
      return row[h] !== undefined ? row[h] : '';
    });
    vals.push(
      row._x.toFixed(4),
      row._panel_no !== null && row._panel_no !== undefined ? row._panel_no : ''
    );
    lines.push(vals.join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'telemetry_with_panels.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Panel stats CSV export ───────────────────────────────────────────────
// Downloads a summary CSV with one row per panel:
//   panel_number, direction_deg, center_x_m, mean_pitch_deg, window_row_count
// panel_number is the absolute panel index; direction_deg indicates which pass.

function exportPanelStatsCSV(panelStats) {
  const headers = ['panel_number', 'direction_deg', 'center_x_m', 'mean_pitch_deg', 'window_row_count'];
  const lines   = [headers.join(',')];

  for (const s of panelStats) {
    lines.push([
      s.panel_no,
      s.dir,
      s.centerX.toFixed(4),
      s.meanPitch.toFixed(4),
      s.windowRowCount
    ].join(','));
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = 'panel_stats.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
