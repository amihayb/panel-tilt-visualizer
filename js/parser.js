// CSV parser + odometry computation.
// Adapted from nextscope dataParser.js — header detection logic reused verbatim.

// ─── CSV header detection (nextscope pattern) ─────────────────────────────

function _splitLine(row) {
  return (row == null ? '' : String(row)).split(',');
}

function _trimNames(names) {
  return names.map(n => n.trim());
}

// Scan up to 20 lines for the first line that has >2 fields and a non-numeric
// second field — that is the header row. Mirrors nextscope getHeader logic.
function _findHeader(lines) {
  const scanLimit = Math.min(20, lines.length);
  for (let i = 0; i < scanLimit; i++) {
    const fields = _splitLine(lines[i]);
    if (fields.length > 2 && isNaN(fields[1])) {
      return { header: _trimNames(fields), startIdx: i + 1 };
    }
  }
  return null;
}

// ─── Time parsing ─────────────────────────────────────────────────────────

// Converts "2000-01-01 HH:MM:SS.mmm" to total seconds.
function _datetimeToSeconds(str) {
  const timePart = str.trim().split(' ')[1];
  if (!timePart) return NaN;
  const [h, m, s] = timePart.split(':');
  return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
}

// ─── Main CSV parser ──────────────────────────────────────────────────────

// Returns { headers: string[], rows: object[] }
// Each row object contains:
//   - raw string values for every CSV column (keyed by header name)
//   - _time_s  : relative seconds from first row (float)
//   - _yaw     : yaw in radians (scaled)
//   - _pitchRaw: pitch in degrees (scaled from CSV, before bias)
//   - _pitch   : pitch in degrees after subtracting CFG.biasPitch
//   - _roll    : roll in degrees (scaled)
//   - _encR    : right encoder ticks (numeric)
//   - _encL    : left encoder ticks (numeric)
function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const headerInfo = _findHeader(lines);
  if (!headerInfo) return { headers: [], rows: [] };

  const { header, startIdx } = headerInfo;
  const sf = CFG.signalScaleFactors;
  const rows = [];
  let t0 = null;

  for (let i = startIdx; i < lines.length; i++) {
    const fields = _splitLine(lines[i]);
    if (fields.length !== header.length) continue;

    // Build raw-value object
    const row = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = fields[j].trim();
    }

    // Time → relative seconds
    const absSeconds = _datetimeToSeconds(row['Time']);
    if (isNaN(absSeconds)) continue;
    if (t0 === null) t0 = absSeconds;
    row._time_s = absSeconds - t0;

    // Apply scale factors to signal columns used downstream
    const applyScale = (key) => {
      const raw = parseFloat(row[key]);
      if (isNaN(raw)) return NaN;
      const cfg = sf[key];
      return cfg ? raw * cfg.scale + cfg.offset : raw;
    };

    row._yaw = applyScale('Yaw'); // radians, CW-positive Z-down

    const rawPitch = applyScale('Pitch');
    row._pitchRaw = rawPitch;
    const bias =
      typeof CFG.biasPitch === 'number' && !Number.isNaN(CFG.biasPitch)
        ? CFG.biasPitch
        : 0;
    row._pitch =
      rawPitch == null || Number.isNaN(rawPitch) ? NaN : rawPitch - bias;

    const rawRoll = applyScale('Roll');
    row._rollRaw = rawRoll;
    const biasRoll =
      typeof CFG.biasRoll === 'number' && !Number.isNaN(CFG.biasRoll)
        ? CFG.biasRoll
        : 0;
    row._roll =
      rawRoll == null || Number.isNaN(rawRoll) ? NaN : rawRoll - biasRoll;
    row._encR  = parseFloat(row['EncoderRight']);
    row._encL  = parseFloat(row['EncoderLeft']);

    rows.push(row);
  }

  return { headers: header, rows };
}

// Recompute `row._pitch` from `_pitchRaw` and current `CFG.biasPitch`.
// Call after the user changes bias in the UI, then re-run assignPanelNumbers.
function reapplyPitchBias(rows) {
  let bias = Number(CFG.biasPitch);
  if (!Number.isFinite(bias)) bias = 0;
  for (const row of rows) {
    const raw = row._pitchRaw;
    row._pitch =
      raw == null || Number.isNaN(raw) ? NaN : raw - bias;
  }
}

// Recompute `row._roll` from `_rollRaw` and current `CFG.biasRoll`.
// Call after the user changes roll bias in the UI.
function reapplyRollBias(rows) {
  let bias = Number(CFG.biasRoll);
  if (!Number.isFinite(bias)) bias = 0;
  for (const row of rows) {
    const raw = row._rollRaw;
    row._roll =
      raw == null || Number.isNaN(raw) ? NaN : raw - bias;
  }
}

// ─── Odometry ─────────────────────────────────────────────────────────────

// Mutates each row in-place, adding _x and _y (meters).
// Yaw convention: CW-positive, Z-down (NED-like).
//   x += d * cos(yaw)   — forward = +X when yaw = 0
//   y += d * sin(yaw)   — East    = +Y when yaw = +90 deg
// Encoder resets (delta < 0) are silently skipped — new drive segment started.
// Returns the same array, with totalDistanceM property attached.
// qualifyingSegs: optional array of row-arrays (qualifying drive segments).
// When provided, X/Y integration is restricted to rows inside those segments.
// Outside qualifying segments, X/Y is frozen at the last computed position.
function computeOdometry(rows, qualifyingSegs = null) {
  const TPM  = CFG.odometry.ticksPerMeter;
  let x      = CFG.odometry.initialX;
  let y      = CFG.odometry.initialY;
  let prevR  = null;
  let prevL  = null;
  let totalDist = 0;

  // Build a Set of qualifying row objects for O(1) lookup
  const qualSet = new Set();
  if (qualifyingSegs) {
    for (const seg of qualifyingSegs)
      for (const r of seg) qualSet.add(r);
  }
  const selective = qualifyingSegs != null;

  for (const row of rows) {
    const isQual = !selective || qualSet.has(row);

    if (isQual && prevR !== null) {
      const dR = (row._encR - prevR) / TPM;
      const dL = (row._encL - prevL) / TPM;

      // Skip on encoder reset (new drive segment — encoders counted back to 0)
      if (dR >= 0 && dL >= 0) {
        const d = (dR + dL) / 2.0;
        x += d * Math.cos(row._yaw);
        y += d * Math.sin(row._yaw);
        totalDist += d;
      }
    }

    row._x = x;
    row._y = y;

    // Only advance encoder baseline for qualifying rows so that non-qualifying
    // gaps don't corrupt the delta when the next qualifying segment begins.
    if (isQual) {
      prevR = row._encR;
      prevL = row._encL;
    }
  }

  rows.totalDistanceM = totalDist;
  return rows;
}

// ─── Drive segment detection ──────────────────────────────────────────────
// A drive is a contiguous run of rows whose yaw stays within ±15° of 0° or
// 180°.  Any row outside those windows is a turn — it ends the current drive.
// A drive only STARTS once the yaw reaches within ±driveStartTolDeg of the
// target angle.  Rows between ±15° and ±driveStartTolDeg are ignored until
// that strict condition is met.
// Everything before the first 180° drive is discarded.

const DRIVE_YAW_TOL_RAD = 15 * Math.PI / 180;  // ±15° — keeps a drive going

function detectDriveSegments(rows) {
  const TOL        = DRIVE_YAW_TOL_RAD;
  const STRICT_TOL = CFG.drives.startTolDeg * Math.PI / 180;

  // Loose: determines which direction a row belongs to (keeps drive alive)
  function classify(yaw) {
    if (isNaN(yaw)) return null;
    if (yaw <= TOL || yaw >= 2 * Math.PI - TOL) return 0;
    if (Math.abs(yaw - Math.PI) <= TOL)          return 180;
    return null;
  }

  // Strict: required for a drive to START
  function classifyStrict(yaw) {
    if (isNaN(yaw)) return null;
    if (yaw <= STRICT_TOL || yaw >= 2 * Math.PI - STRICT_TOL) return 0;
    if (Math.abs(yaw - Math.PI) <= STRICT_TOL)                 return 180;
    return null;
  }

  const seg0 = [], seg180 = [];
  let confirmedDir = null;
  let confirmedSeg = null;

  const pushSeg = () => {
    if (confirmedSeg && confirmedSeg.length >= 2) {
      if (confirmedDir === 0)   seg0.push(confirmedSeg);
      if (confirmedDir === 180) seg180.push(confirmedSeg);
    }
    confirmedSeg = null;
    confirmedDir = null;
  };

  for (const row of rows) {
    const dir       = classify(row._yaw);
    const strictDir = classifyStrict(row._yaw);

    if (dir === null) {
      // Turning — end current drive
      pushSeg();
    } else if (confirmedDir !== null && dir === confirmedDir) {
      // Continuing confirmed drive (loose tolerance keeps it alive)
      confirmedSeg.push(row);
    } else if (confirmedDir !== null && dir !== confirmedDir) {
      // Direction switched without a null — flush and wait for strict condition
      pushSeg();
      if (strictDir !== null) {
        confirmedDir = strictDir;
        confirmedSeg = [row];
      }
    } else {
      // No active drive — only start when strict angle is reached
      if (strictDir !== null) {
        confirmedDir = strictDir;
        confirmedSeg = [row];
      }
    }
  }
  pushSeg();

  // Discard everything before the first 180° drive
  const first180 = seg180[0];
  if (!first180) return { seg0: [], seg180: [] };

  const t180 = first180[0]._time_s;
  return {
    seg0:   seg0.filter(s => s[0]._time_s >= t180),
    seg180
  };
}

// ─── Panel number assignment ──────────────────────────────────────────────
// Stamps _panel_no on every row in-place.
//
//   -1  : not in a qualifying drive, or in a detected gap
//   ≥ 0 : ordinal panel index within a continuous directional pass
//
// A "pass" is a group of consecutive same-direction segments (0° or 180°).
// Encoder resets within a pass split it into multiple segments, but the panel
// counter carries over — it does NOT restart for each sub-segment.
//
// Panel number assignment:
//   - 0°  drives: panels numbered +startPanel, +startPanel+1, … (positive, continuous)
//   - 180° drives: panels numbered -startPanel, -startPanel-1, … (negative, continuous)
//   - Counters do NOT reset between drives of the same direction.
//   - All drives processed in time order so counters advance correctly.

function assignPanelNumbers(rows, seg0, seg180) {
  const threshold  = CFG.gaps.pitchDiffDegPerMeter;
  const startPanel = CFG.panels.startPanel;

  // Merge and sort all drives by start time, keeping direction label
  const allDrives = [
    ...seg0.map(seg   => ({ seg, dir:   0 })),
    ...seg180.map(seg => ({ seg, dir: 180 }))
  ].sort((a, b) => a.seg[0]._time_s - b.seg[0]._time_s);

  for (const row of rows) row._panel_no = null;

  // counter is a number line: 0° moves right (++), 180° moves left (--).
  // Initialise so the very first panel is ±startPanel.
  const firstDir = allDrives.find(d => d.seg.length >= 2)?.dir ?? 0;
  let counter = firstDir === 0 ? startPanel : -startPanel;
  let prevDir = null;

  for (const { seg: drive, dir } of allDrives) {
    if (drive.length < 2) continue;

    // 1-3. State-machine panel splitter with hysteresis:
    //   - Enter gap mode when dPitch/dX > threshold.
    //   - Exit gap mode (start new panel) only after dPitch/dX < 0.5*threshold
    //     for at least MIN_STABLE_M metres continuously.
    //   - The new panel begins from the first row of that stable run.
    const MIN_STABLE_M   = CFG.gaps.stableMinLengthM;
    const STABLE_RATIO   = CFG.gaps.stableRatio;

    const panels = [];
    let cur          = [drive[0]];
    let inGap        = false;
    let stableStartIdx = null;
    let stableDistM  = 0;

    for (let i = 1; i < drive.length; i++) {
      const prev = drive[i - 1];
      const row  = drive[i];
      const dX   = Math.abs(row._x - prev._x);

      if (dX < 0.002) {
        if (!inGap) cur.push(row);
        continue;
      }

      const dPdX = Math.abs(row._pitch - prev._pitch) / dX;

      if (!inGap) {
        if (dPdX > threshold) {
          // Spike detected → enter gap mode; cur holds rows up to prev
          inGap        = true;
          stableStartIdx = null;
          stableDistM  = 0;
        } else {
          cur.push(row);
        }
      } else {
        if (dPdX < threshold * STABLE_RATIO) {
          if (stableStartIdx === null) stableStartIdx = i;
          stableDistM += dX;
          if (stableDistM >= MIN_STABLE_M) {
            // Confirmed stable: close old panel, new one starts at stableStartIdx
            if (cur.length >= 2) panels.push(cur);
            cur          = drive.slice(stableStartIdx, i + 1);
            inGap        = false;
            stableStartIdx = null;
            stableDistM  = 0;
          }
        } else {
          // Still noisy → reset the stable run
          stableStartIdx = null;
          stableDistM  = 0;
        }
      }
    }
    if (cur.length >= 2) panels.push(cur);

    // Keep only panels whose X span is > 0.4 m.
    // The first and last panels are exempt because they may be partial
    // (robot starts or ends mid-panel).
    const MIN_PANEL_LENGTH_M = 0.4;
    const filteredPanels = panels.filter((panel, idx) => {
      if (idx === 0 || idx === panels.length - 1) return true;
      const xs = panel.map(r => r._x);
      return Math.max(...xs) - Math.min(...xs) > MIN_PANEL_LENGTH_M;
    });

    if (filteredPanels.length === 0) continue;

    // 4. Stamp panel numbers on the number line (0° goes right ++, 180° goes left --).
    //    On direction change, rewind by one step so the first panel of the new
    //    drive lands on the same number as the last panel of the previous drive
    //    (the robot turned around on the same physical panel).
    if (prevDir !== null && prevDir !== dir) {
      if (prevDir === 0) counter--;   // undo last ++
      else               counter++;  // undo last --
    }

    for (const panel of filteredPanels) {
      const pn = dir === 0 ? counter++ : counter--;
      for (const r of panel) r._panel_no = pn;
    }
    prevDir = dir;
  }
}

// ─── Panel center stats ───────────────────────────────────────────────────
// Scans rows in time order and identifies every contiguous run of the same
// panel_no (a "panel occurrence").  Each occurrence becomes one entry in the
// returned array — so the same panel_no can appear multiple times (once per
// pass, or once per direction).
//
// For each occurrence:
//   centerX    = midpoint of the run's X range
//   dir        = 0 or 180, from the yaw of the row closest to centerX
//                (within ±90° of 0 rad → 0° pass, otherwise → 180° pass)
//   meanPitch  = mean pitch of rows within ±10 cm of centerX
//                (falls back to all rows in the run if the window is empty)
//
// Returns array of { panel_no, dir, centerX, meanPitch, windowRowCount }
// in time order (no sorting by panel_no).

function computePanelStats(rows) {
  const HALF_WINDOW = 0.10; // metres — ±10 cm

  function statsForRun(runRows) {
    const xs      = runRows.map(r => r._x);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;

    // Row closest to centerX → yaw determines direction
    const centerRow = runRows.reduce((best, r) =>
      Math.abs(r._x - centerX) < Math.abs(best._x - centerX) ? r : best
    );
    const yaw = ((centerRow._yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const dir = (yaw <= Math.PI / 2 || yaw >= 3 * Math.PI / 2) ? 0 : 180;

    const windowRows = runRows.filter(r => Math.abs(r._x - centerX) <= HALF_WINDOW);
    const sampleRows = windowRows.length > 0 ? windowRows : runRows;
    const meanPitch  = sampleRows.reduce((s, r) => s + r._pitch, 0) / sampleRows.length;
    const meanRoll   = sampleRows.reduce((s, r) => s + r._roll,  0) / sampleRows.length;

    return {
      panel_no:       runRows[0]._panel_no,
      dir,
      centerX,
      meanPitch,
      meanRoll,
      windowRowCount: sampleRows.length
    };
  }

  const stats   = [];
  let currentRun = [];

  for (const row of rows) {
    const pn = row._panel_no;
    if (pn === null || pn === undefined) {
      // Gap between panels — close any open run
      if (currentRun.length > 0) {
        stats.push(statsForRun(currentRun));
        currentRun = [];
      }
    } else if (currentRun.length > 0 && pn !== currentRun[0]._panel_no) {
      // Panel number changed — close previous run, start new one
      stats.push(statsForRun(currentRun));
      currentRun = [row];
    } else {
      currentRun.push(row);
    }
  }
  if (currentRun.length > 0) stats.push(statsForRun(currentRun));

  return stats; // time order — one entry per contiguous panel occurrence
}

// ─── Stats bar update ─────────────────────────────────────────────────────

function updateStatsBar(rows) {
  const n       = rows.length;
  const timeSpan = n > 1 ? (rows[n - 1]._time_s - rows[0]._time_s).toFixed(1) : '0';
  const dist    = rows.totalDistanceM.toFixed(2);

  document.getElementById('stat-rows').textContent     = n.toLocaleString();
  document.getElementById('stat-distance').textContent = dist;
  document.getElementById('stat-timespan').textContent = timeSpan;
}
