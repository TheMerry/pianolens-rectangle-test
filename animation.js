import { BUILD, REPORT_KEY, WARMUP_MS, rectangleAt, VisibleClock, Distribution, Cadence, drawBucket } from './timing.js';

const params = new URLSearchParams(location.search);
const requested = params.get('fps') || '30';
const targetFps = requested === 'native' ? null : requested === '15' ? 15 : 30;
const canvas = document.getElementById('display');
const context = canvas.getContext('2d', { alpha: false });
if (!context) throw new Error('Canvas 2D unavailable');
const clock = new VisibleClock(performance.now());
const raf = new Cadence(), paints = new Cadence(), drawing = new Distribution();
const longTasks = new Distribution();
const startedUnixMs = Date.now();
const visibility = [], checkpoints = [];
let handle = null, lastBucket = -1, lastPaint = null, measured = false, storageError = null, navigating = false;
let longTaskSupported = false, longTaskObserver = null;

try {
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver(list => {
      if (!document.hidden && measured) for (const entry of list.getEntries()) longTasks.add(entry.duration);
    });
    longTaskObserver.observe({ type: 'longtask', buffered: false }); longTaskSupported = true;
  }
} catch { /* Optional browser facility; absence is reported. */ }

function snapshot() {
  const now = performance.now();
  const visibleMs = clock.value(now);
  const seconds = Math.max(0, visibleMs - WARMUP_MS) / 1000;
  return {
    build: BUILD, capturedUnixMs: Date.now(), startedUnixMs, requestedTargetFps: targetFps ?? 'native RAF',
    environment: { userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio,
      secureContext: isSecureContext, origin: location.origin,
      declaredSurface: params.get('surface') || 'unspecified', hardwareAttested: false },
    visibleElapsedMs: visibleMs, warmupMs: WARMUP_MS, measuredVisibleSeconds: seconds,
    documentHidden: document.hidden, raf: raf.summary(seconds), canvasDraws: paints.summary(seconds),
    drawCpuTime: drawing.summary(), timeSinceLastPaintMs: lastPaint === null ? null : now - lastPaint,
    longTasks: { supported: longTaskSupported, durations: longTasks.summary() },
    actualOpticalPresentationFps: null, actualOpticalLatencyMs: null,
    storageError, visibilityEvents: [...visibility], checkpoints: [...checkpoints],
    interpretation: 'RAF callbacks and Canvas calls are browser metrics, not proof of lens presentation. Hidden intervals are excluded. No Android or WebSocket connection exists in Milestone A.'
  };
}

function persist(checkpoint = false) {
  const report = snapshot();
  if (checkpoint) {
    if (checkpoints.length >= 60) checkpoints.shift();
    checkpoints.push({ visibleSeconds: report.measuredVisibleSeconds, rafRate: report.raf.ratePerSecond,
      drawRate: report.canvasDraws.ratePerSecond, longestRafGapMs: report.raf.intervals.maxMs });
    report.checkpoints = [...checkpoints];
  }
  try { localStorage.setItem(REPORT_KEY, JSON.stringify(report)); storageError = null; }
  catch (error) { storageError = error.name; }
  return report;
}

function frame(timestamp) {
  handle = null;
  if (document.hidden || navigating) return;
  const elapsed = clock.value(timestamp);
  measured = elapsed >= WARMUP_MS;
  if (measured) raf.record(timestamp);
  const bucket = drawBucket(elapsed, targetFps);
  if (targetFps === null || bucket !== lastBucket) {
    const start = performance.now();
    const rect = rectangleAt(elapsed);
    context.fillStyle = '#000000'; context.fillRect(0, 0, 600, 600);
    context.fillStyle = '#ffffff'; context.fillRect(rect.x, rect.y, rect.width, rect.height);
    const duration = performance.now() - start;
    lastBucket = bucket; lastPaint = performance.now();
    if (measured) { paints.record(timestamp); drawing.add(duration); }
  }
  handle = requestAnimationFrame(frame);
}

function changeVisibility() {
  const now = performance.now();
  if (visibility.length >= 100) visibility.shift();
  visibility.push({ atUnixMs: Date.now(), hidden: document.hidden, visibleElapsedMs: clock.value(now) });
  if (document.hidden) {
    clock.pause(now); if (handle !== null) cancelAnimationFrame(handle); handle = null;
    persist();
  } else {
    clock.resume(now); raf.breakSegment(); paints.breakSegment(); lastBucket = -1;
    if (handle === null) handle = requestAnimationFrame(frame);
  }
}
document.addEventListener('visibilitychange', changeVisibility);
addEventListener('pagehide', () => { clock.pause(performance.now()); persist(); longTaskObserver?.disconnect(); });
addEventListener('pageshow', event => { if (event.persisted) { changeVisibility(); } });

// A diagnostics-only route, reachable by Select; the animation surface has no overlay controls.
function showReport() { if (!navigating) { persist(); navigating = true; location.assign('report.html'); } }
canvas.addEventListener('click', showReport);
canvas.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); showReport(); } });
canvas.focus({ preventScroll: true });

// Browser-only diagnostic hook, not a phone transport or a presentation callback.
window.pianoLensRectangleReport = () => snapshot();
window.pianoLensRectangleSave = () => persist();
setInterval(() => { if (!document.hidden) persist(true); }, 10000);
context.fillStyle = '#000000'; context.fillRect(0, 0, 600, 600);
if (document.hidden) clock.pause(performance.now());
else handle = requestAnimationFrame(frame);
