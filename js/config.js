// Loads config.json and exposes window.CFG.
// Falls back to embedded defaults when running from file:// or if fetch fails.

const CFG_DEFAULTS = {
  odometry: {
    ticksPerMeter: 1200,
    initialX: 0.0,
    initialY: 0.0
  },
  signalScaleFactors: {
    Time:            { scale: 1.0,       offset: 0, unit: 's',    description: 'Relative seconds from start (computed)' },
    EncoderRight:    { scale: 1.0,       offset: 0, unit: 'ticks',description: 'Right encoder, cumulative ticks' },
    EncoderLeft:     { scale: 1.0,       offset: 0, unit: 'ticks',description: 'Left encoder, cumulative ticks' },
    Yaw:             { scale: 1.7453e-4, offset: 0, unit: 'rad',  description: 'Heading, CW-positive, Z-down, raw in 0.01 deg' },
    Roll:            { scale: 0.01,      offset: 0, unit: 'deg',  description: 'Roll angle, raw in 0.01 deg' },
    Pitch:           { scale: 0.01,      offset: 0, unit: 'deg',  description: 'Pitch angle, raw in 0.01 deg' },
    UltrasonicRight: { scale: 0.001,     offset: 0, unit: 'm',    description: 'Right ultrasonic, raw to meters' },
    UltrasonicLeft:  { scale: 0.001,     offset: 0, unit: 'm',    description: 'Left ultrasonic, raw to meters' }
  },
  panels: {
    widthM: 1.13,
    gapWidthM: 0.02,
    ticksPerMeter: 1262,
    trimM: 0.04,
    startPanel: 0
  },

  drives: {
    startTolDeg: 1
  },

  gaps: {
    pitchDiffDegPerMeter: 80,
    clusterSpacingM: 0.5,
    gapHalfWidthM: 0.01,
    stableMinLengthM: 0.2,
    stableRatio: 0.5
  },

  display: {
    trailColor: '#D4523A',
    pitchColorscale: 'RdBu',
    rollColorscale: 'Viridis',
    markerSize: 5,
    lineWidth: 2
  },

  /** Degrees subtracted from scaled Pitch after CSV load (`pitch = pitch_raw - biasPitch`). */
  biasPitch: 1.1
};

async function loadConfig() {
  try {
    const r = await fetch('./config.json');
    if (!r.ok) throw new Error('fetch failed');
    window.CFG = await r.json();
  } catch {
    window.CFG = JSON.parse(JSON.stringify(CFG_DEFAULTS));
    console.warn('config.json not loaded — using built-in defaults');
  }
  if (typeof CFG.biasPitch !== 'number' || Number.isNaN(CFG.biasPitch)) {
    CFG.biasPitch = CFG_DEFAULTS.biasPitch;
  }
}
