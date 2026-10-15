// Android owns the state. The browser interpolates only the rectangle's visual clock.
export class CommandClock {
  constructor() { this.sessionId = null; this.revision = -1; this.positionMs = 0; this.speed = 1; this.playing = false; this.anchor = 0; }
  value(now) { return this.positionMs + (this.playing ? Math.max(0, now - this.anchor) * this.speed : 0); }
  apply(m, now, transitMs = 0) {
    if (!m || m.v !== 1 || !['state','start','pause','resume','reset','speed'].includes(m.type) ||
        typeof m.sessionId !== 'string' || !m.sessionId.length || m.sessionId.length > 80 ||
        !Number.isSafeInteger(m.revision) || m.revision < 0 ||
        !Number.isFinite(m.positionMs) || m.positionMs < 0 || m.positionMs > 86400000 ||
        !Number.isFinite(m.speed) || m.speed < .25 || m.speed > 1.5 || typeof m.playing !== 'boolean' ||
        !Number.isFinite(now) || !Number.isFinite(transitMs)) return false;
    if (this.sessionId === m.sessionId && m.revision <= this.revision) return false;
    this.sessionId = m.sessionId; this.revision = m.revision;
    this.positionMs = m.positionMs + (m.playing ? Math.max(0, Math.min(1000, transitMs)) * m.speed : 0);
    this.speed = m.speed; this.playing = m.playing; this.anchor = now; return true;
  }
  freeze(now) { this.positionMs = this.value(now); this.anchor = now; this.playing = false; }
}
export function validateEndpoint(raw) {
  const u = new URL(raw);
  if (u.username || u.password || u.hash || u.search || u.pathname !== '/rectangle') throw new Error('Use a /rectangle endpoint without credentials or query parameters');
  const p = u.hostname.split('.').map(Number);
  const ipv4 = p.length === 4 && p.every(x => Number.isInteger(x) && x >= 0 && x <= 255);
  const local = u.hostname === 'localhost' || u.hostname === '[::1]' || (ipv4 && (p[0] === 127 || p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168)));
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && local)) throw new Error('Plaintext testing is limited to loopback/private IPv4; otherwise trusted wss is required');
  return u.href;
}
