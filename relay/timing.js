// Pure timing helpers: no Android, music, MIDI, microphone, or communication code.
export const BUILD = 'rectangle-B1';
export const REPORT_KEY = 'pianolens.rectangle.B1.lastReport';
export const WARMUP_MS = 2000;

export function rectangleAt(elapsedMs) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error('Invalid elapsed time');
  const travel = 408;
  const distance = (elapsedMs * 0.12) % (travel * 2);
  return { x: 284, y: 48 + Math.round(distance <= travel ? distance : travel * 2 - distance), width: 32, height: 96 };
}

export class VisibleClock {
  constructor(now) { this.anchor = now; this.accumulated = 0; this.running = true; }
  value(now) { return this.accumulated + (this.running ? Math.max(0, now - this.anchor) : 0); }
  pause(now) { if (this.running) { this.accumulated = this.value(now); this.running = false; } }
  resume(now) { if (!this.running) { this.anchor = now; this.running = true; } }
}

export class Distribution {
  constructor() { this.bins = new Uint32Array(2001); this.count = 0; this.sum = 0; this.max = 0; }
  add(value) {
    if (!Number.isFinite(value) || value < 0) return;
    this.count++; this.sum += value; this.max = Math.max(this.max, value);
    this.bins[Math.min(2000, Math.floor(value))]++;
  }
  summary() {
    let seen = 0, p95 = null;
    for (let i = 0; i < this.bins.length && this.count; i++) {
      seen += this.bins[i];
      if (seen >= Math.ceil(this.count * 0.95)) { p95 = i; break; }
    }
    return { samples: this.count, meanMs: this.count ? this.sum / this.count : null,
      p95BucketLowerMs: p95, maxMs: this.count ? this.max : null,
      bucketWidthMs: 1, overflowBucketStartsMs: 2000 };
  }
}

export class Cadence {
  constructor() { this.last = null; this.callbacks = 0; this.intervals = new Distribution(); this.over100Ms = 0; this.over1000Ms = 0; }
  record(timestamp) {
    this.callbacks++;
    if (this.last !== null) {
      const interval = timestamp - this.last;
      this.intervals.add(interval);
      if (interval > 100) this.over100Ms++;
      if (interval > 1000) this.over1000Ms++;
    }
    this.last = timestamp;
  }
  breakSegment() { this.last = null; }
  summary(seconds) { return { callbacks: this.callbacks, ratePerSecond: seconds > 0 ? this.callbacks / seconds : null,
    intervals: this.intervals.summary(), gapsOver100Ms: this.over100Ms, gapsOver1000Ms: this.over1000Ms }; }
}

export function drawBucket(elapsedMs, targetFps) {
  return targetFps === null ? null : Math.floor(elapsedMs * targetFps / 1000);
}
