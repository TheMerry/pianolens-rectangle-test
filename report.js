import { REPORT_KEY } from './timing.js';
let report = null;
try { report = JSON.parse(localStorage.getItem(REPORT_KEY) || 'null'); }
catch { /* A unavailable store has no report; do not invent measurements. */ }
document.getElementById('report').textContent = report ? JSON.stringify(report, null, 2) : 'No report on this browser/device. Run the animation, then Select to return here.';
document.getElementById('summary').textContent = report ? `${report.measuredVisibleSeconds.toFixed(1)} measured visible seconds · RAF ${report.raf.ratePerSecond?.toFixed(1) ?? '—'}/s · Canvas ${report.canvasDraws.ratePerSecond?.toFixed(1) ?? '—'}/s` : '';
document.getElementById('download').disabled = !report;
document.getElementById('download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pianolens-rectangle-A1.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector('a').focus();
