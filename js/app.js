(async () => {
  await loadConfig();

  const fileInput  = document.getElementById('file-input');
  const exportBtn       = document.getElementById('export-btn');
  const exportPanelBtn  = document.getElementById('export-panel-btn');
  const dropZone        = document.getElementById('drop-zone');
  const statsBar   = document.getElementById('stats-bar');
  const plotArea   = document.getElementById('plot-area');
  const themeBtn   = document.getElementById('theme-toggle');
  const themeIcon  = document.getElementById('theme-icon');
  const axisToggle       = document.getElementById('axis-toggle');
  const axisBtns         = axisToggle.querySelectorAll('.axis-btn');
  const edgeToggle       = document.getElementById('side-view-edge-toggle');
  const edgeBtns         = edgeToggle.querySelectorAll('.axis-btn');

  let loadedRows, loadedHeaders, loadedPanelStats;
  let loadedSeg0, loadedSeg180;
  let sideViewEdge = 1; // 1 = East, -1 = West

  const startPanelInput = document.getElementById('start-panel-input');
  const biasPitchInput  = document.getElementById('bias-pitch-input');
  const biasRollInput   = document.getElementById('bias-roll-input');
  const STORAGE_START_PANEL = 'pt-start-panel';
  const STORAGE_BIAS_PITCH  = 'pt-bias-pitch';
  const STORAGE_BIAS_ROLL   = 'pt-bias-roll';

  // ── File handling ───────────────────────────────────────────────────
  function handleFile(file) {
    const reader = new FileReader();
    reader.addEventListener('load', (e) => {
      const text = e.target.result || '';
      const { headers, rows } = parseCSV(text);

      if (!rows.length) {
        alert('No data rows found in the file.');
        return;
      }

      const { seg0, seg180 } = detectDriveSegments(rows);
      const allQualSegs = [...seg0, ...seg180];

      computeOdometry(rows, allQualSegs);
      computeEdgeDrive(rows, seg0, seg180);
      assignPanelNumbers(rows, seg0, seg180);

      loadedPanelStats = computePanelStats(rows);
      loadedRows       = rows;
      loadedHeaders    = headers;
      loadedSeg0       = seg0;
      loadedSeg180     = seg180;

      startPanelInput.value = String(CFG.panels.startPanel);
      biasPitchInput.value  = String(CFG.biasPitch);
      biasRollInput.value   = String(CFG.biasRoll);

      // Show UI before rendering so Plotly measures real widths
      dropZone.classList.add('hidden');
      statsBar.classList.remove('hidden');
      plotArea.classList.remove('hidden');

      updateStatsBar(rows);
      renderPanelMeanPitchPlot(loadedPanelStats);
      renderPanelTiltLinesPlot(loadedPanelStats);
      renderPanelMeanRollPlot(loadedPanelStats);
      renderPanelRollLinesPlot(loadedPanelStats);
      renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis || 'pitch', sideViewEdge);
      renderPitchPlot(rows);

      exportBtn.classList.remove('disabled');
      exportPanelBtn.classList.remove('disabled');
    });
    reader.readAsText(file);
  }

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    e.target.value = '';
  });

  exportBtn.addEventListener('click', () => {
    if (loadedRows) exportCSV(loadedRows, loadedHeaders);
  });

  exportPanelBtn.addEventListener('click', () => {
    if (loadedPanelStats) exportPanelStatsCSV(loadedPanelStats);
  });

  // ── Bias pitch (live): update displayed pitch only ───────────────────
  function parseBiasInput(str) {
    const t = String(str).trim().replace(',', '.');
    if (
      t === '' ||
      t === '-' ||
      t === '+' ||
      t === '.' ||
      t === '-.' ||
      t === '+.'
    )
      return NaN;
    const v = parseFloat(t);
    return Number.isFinite(v) ? v : NaN;
  }

  function parseSignedIntegerInput(str) {
    const t = String(str).trim();
    if (t === '' || t === '-' || t === '+') return NaN;
    if (!/^[+-]?\d+$/.test(t)) return NaN;
    const v = Number(t);
    return Number.isSafeInteger(v) ? v : NaN;
  }

  function loadSavedTuningValues() {
    const savedStartPanel = parseSignedIntegerInput(localStorage.getItem(STORAGE_START_PANEL));
    if (Number.isFinite(savedStartPanel)) CFG.panels.startPanel = savedStartPanel;

    const savedBiasPitch = parseBiasInput(localStorage.getItem(STORAGE_BIAS_PITCH));
    if (Number.isFinite(savedBiasPitch)) CFG.biasPitch = savedBiasPitch;

    const savedBiasRoll = parseBiasInput(localStorage.getItem(STORAGE_BIAS_ROLL));
    if (Number.isFinite(savedBiasRoll)) CFG.biasRoll = savedBiasRoll;
  }

  function saveTuningValue(key, value) {
    localStorage.setItem(key, String(value));
  }

  loadSavedTuningValues();

  function renderAllPlots() {
    renderPanelMeanPitchPlot(loadedPanelStats);
    renderPanelTiltLinesPlot(loadedPanelStats);
    renderPanelMeanRollPlot(loadedPanelStats);
    renderPanelRollLinesPlot(loadedPanelStats);
    renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis || 'pitch', sideViewEdge);
    renderPitchPlot(loadedRows);
  }

  // ── Start panel (live): re-number panels + replot ────────────────────
  function applyStartPanelAndRefreshPlots() {
    if (!loadedRows) return false;
    const v = parseSignedIntegerInput(startPanelInput.value);
    if (!Number.isFinite(v)) return false;
    saveTuningValue(STORAGE_START_PANEL, v);
    CFG.panels.startPanel = v;
    assignPanelNumbers(loadedRows, loadedSeg0 || [], loadedSeg180 || []);
    loadedPanelStats = computePanelStats(loadedRows);
    renderAllPlots();
    return true;
  }

  startPanelInput.addEventListener('input', () => {
    applyStartPanelAndRefreshPlots();
  });

  startPanelInput.addEventListener('change', () => {
    applyStartPanelAndRefreshPlots();
  });

  startPanelInput.addEventListener('blur', () => {
    if (!loadedRows) return;
    if (!applyStartPanelAndRefreshPlots())
      startPanelInput.value = String(CFG.panels.startPanel);
  });

  function applyBiasAndRefreshPlots() {
    if (!loadedRows) return false;
    const v = parseBiasInput(biasPitchInput.value);
    if (!Number.isFinite(v)) return false;
    if (v === CFG.biasPitch) return true;
    saveTuningValue(STORAGE_BIAS_PITCH, v);
    CFG.biasPitch = v;
    reapplyPitchBias(loadedRows, loadedPanelStats);
    renderPanelMeanPitchPlot(loadedPanelStats);
    renderPanelTiltLinesPlot(loadedPanelStats);
    renderPitchPlot(loadedRows);
    return true;
  }

  biasPitchInput.addEventListener('input', () => {
    applyBiasAndRefreshPlots();
  });

  biasPitchInput.addEventListener('change', () => {
    applyBiasAndRefreshPlots();
  });

  biasPitchInput.addEventListener('blur', () => {
    if (!loadedRows) return;
    if (!applyBiasAndRefreshPlots())
      biasPitchInput.value = String(CFG.biasPitch);
  });

  // ── Bias roll (live): replot roll charts only ────────────────────────
  function applyRollBiasAndRefreshPlots() {
    if (!loadedRows) return false;
    const v = parseBiasInput(biasRollInput.value);
    if (!Number.isFinite(v)) return false;
    if (v === CFG.biasRoll) return true;
    saveTuningValue(STORAGE_BIAS_ROLL, v);
    CFG.biasRoll = v;
    reapplyRollBias(loadedRows);
    loadedPanelStats = computePanelStats(loadedRows);
    renderPanelMeanRollPlot(loadedPanelStats);
    renderPanelRollLinesPlot(loadedPanelStats);
    renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis || 'pitch', sideViewEdge);
    return true;
  }

  biasRollInput.addEventListener('input', () => {
    applyRollBiasAndRefreshPlots();
  });

  biasRollInput.addEventListener('change', () => {
    applyRollBiasAndRefreshPlots();
  });

  biasRollInput.addEventListener('blur', () => {
    if (!loadedRows) return;
    if (!applyRollBiasAndRefreshPlots())
      biasRollInput.value = String(CFG.biasRoll);
  });

  // ── Click on drop zone opens file picker ────────────────────────────
  dropZone.addEventListener('click', () => fileInput.click());

  // ── Drag and drop ───────────────────────────────────────────────────
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
  });
  document.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
  });
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  // ── Theme toggle ────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pt-theme', theme);
    themeIcon.className = theme === 'dark' ? 'fa fa-moon-o' : 'fa fa-sun-o';
    // Re-render plots so Plotly picks up the new CSS color variables
    if (loadedPanelStats) {
      renderPanelMeanPitchPlot(loadedPanelStats);
      renderPanelTiltLinesPlot(loadedPanelStats);
      renderPanelMeanRollPlot(loadedPanelStats);
      renderPanelRollLinesPlot(loadedPanelStats);
      renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis || 'pitch', sideViewEdge);
    }
    if (loadedRows) renderPitchPlot(loadedRows);
  }

  themeBtn.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  });

  applyTheme(localStorage.getItem('pt-theme') || 'dark');

  // ── Side-view resize handle ──────────────────────────────────────────
  const resizeHandle  = document.getElementById('resize-handle');
  const sideViewEl    = document.getElementById('side-view-wrapper');

  let _resizing   = false;
  let _startX     = 0;
  let _startWidth = 0;

  resizeHandle.addEventListener('mousedown', (e) => {
    _resizing   = true;
    _startX     = e.clientX;
    _startWidth = sideViewEl.offsetWidth;
    resizeHandle.classList.add('dragging');
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!_resizing) return;
    // dragging left → larger side view; dragging right → smaller
    const newWidth = Math.max(150, Math.min(700, _startWidth + (_startX - e.clientX)));
    sideViewEl.style.width     = newWidth + 'px';
    sideViewEl.style.flexBasis = newWidth + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!_resizing) return;
    _resizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor    = '';
    document.body.style.userSelect = '';
    // Let Plotly re-measure all chart containers
    window.dispatchEvent(new Event('resize'));
  });

  // ── Pitch / Roll axis toggle ─────────────────────────────────────────
  axisBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const axis = btn.dataset.axis;
      if (plotArea.dataset.axis === axis) return;
      axisBtns.forEach(b => b.classList.toggle('active', b === btn));
      plotArea.dataset.axis = axis;
      // Re-render the newly visible plots so Plotly measures real widths
      if (!loadedPanelStats) return;
      if (axis === 'pitch') {
        renderPanelTiltLinesPlot(loadedPanelStats);
        renderPanelMeanPitchPlot(loadedPanelStats);
      } else {
        renderPanelRollLinesPlot(loadedPanelStats);
        renderPanelMeanRollPlot(loadedPanelStats);
      }
      renderSideViewPlot(loadedPanelStats, axis, sideViewEdge);
      // Let the browser apply CSS layout changes (side-view appearing/hiding)
      // before telling Plotly to resize all charts to their new container widths.
      setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
    });
  });

  // ── Side-view East / West edge toggle ────────────────────────────────
  edgeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const edge = btn.dataset.edge === 'east' ? 1 : -1;
      if (sideViewEdge === edge) return;
      sideViewEdge = edge;
      edgeBtns.forEach(b => b.classList.toggle('active', b === btn));
      if (!loadedPanelStats) return;
      renderSideViewPlot(loadedPanelStats, plotArea.dataset.axis || 'pitch', sideViewEdge);
    });
  });
})();
