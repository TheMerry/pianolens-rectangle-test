import { CommandClock, validateEndpoint } from './commands.js';
export function rectangleConnection() {
  const clock = new CommandClock();
  const report = { enabled: true, status: 'not configured', route: null, attempts: 0, reconnects: 0, commands: 0, rejected: 0, lastRevision: null, lastRoundTripMs: null, lastCommandAgeEstimateMs: null, events: [] };
  let config = null, socket = null, retry = null, deadline = null, attempts = 0, disposed = false, offset = null;
  const pings = new Map();
  function event(status) { report.status = status; if (report.events.length >= 40) report.events.shift(); report.events.push({ atUnixMs: Date.now(), status }); }
  try {
    const f = new URLSearchParams(location.hash.slice(1));
    if (f.has('ws')) {
      config = { endpoint: validateEndpoint(f.get('ws')), token: f.get('token') || '' };
      if (!/^[a-f0-9]{32}$/.test(config.token)) throw new Error('Invalid token');
      sessionStorage.setItem('pianolens.rectangle.connection', JSON.stringify(config));
      history.replaceState(null, '', location.pathname + location.search);
    } else {
      config = JSON.parse(sessionStorage.getItem('pianolens.rectangle.connection') || 'null');
      if (config) { config.endpoint = validateEndpoint(config.endpoint); if (!/^[a-f0-9]{32}$/.test(config.token)) config = null; }
    }
  } catch { config = null; event('invalid or unavailable configuration'); }
  if (config) report.route = config.endpoint; // Never include pairing tokens in reports.
  function clearTimers() { clearTimeout(deadline); clearTimeout(retry); deadline = retry = null; pings.clear(); }
  function suspend() { clearTimers(); clock.freeze(performance.now()); const old = socket; socket = null; old?.close(1000, 'surface hidden or closed'); }
  function connect() {
    if (disposed || document.hidden || !config || socket) return;
    report.attempts++; event('connecting');
    let ws; try { ws = new WebSocket(config.endpoint); } catch (error) { event(`browser refused connection (${error.name})`); return; }
    socket = ws; offset = null;
    deadline = setTimeout(() => { if (socket === ws && report.status !== 'connected') { event('connection/authentication timeout'); ws.close(); } }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', v: 1, token: config.token }));
    ws.onmessage = ({ data }) => {
      if (socket !== ws || typeof data !== 'string' || data.length > 4096) return;
      let m; try { m = JSON.parse(data); } catch { report.rejected++; return; }
      if (m.type === 'ready') {
        clearTimeout(deadline); deadline = null; attempts = 0; event('connected');
        const id = Date.now().toString(); pings.set(id, { mono: performance.now(), wall: Date.now() }); ws.send(JSON.stringify({ type: 'ping', id }));
      } else if (m.type === 'pong' && pings.has(m.id) && Number.isFinite(m.serverUnixMs)) {
        const sent = pings.get(m.id); pings.delete(m.id);
        const rtt = performance.now() - sent.mono; report.lastRoundTripMs = rtt;
        offset = m.serverUnixMs - (sent.wall + rtt / 2);
        ws.send(JSON.stringify({ type: 'snapshot' }));
      } else {
        const age = offset !== null && Number.isFinite(m.sentAt) ? Date.now() + offset - m.sentAt : 0;
        if (clock.apply(m, performance.now(), age)) {
          report.commands++; report.lastRevision = m.revision; report.lastCommandAgeEstimateMs = offset === null ? null : Math.max(0, age);
          ws.send(JSON.stringify({ type: 'ack', revision: m.revision }));
        } else report.rejected++;
      }
    };
    ws.onerror = () => { if (socket === ws) event('WebSocket error; inspect browser policy/network'); };
    ws.onclose = ({ code }) => {
      if (socket !== ws) return;
      socket = null; clearTimers(); clock.freeze(performance.now()); event(`disconnected (${code}); rectangle frozen`);
      if (code === 4003 || code === 4004) return;
      if (!disposed && !document.hidden) { const wait = Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 250; report.reconnects++; retry = setTimeout(connect, wait); }
    };
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else connect(); });
  addEventListener('pagehide', () => { disposed = true; suspend(); });
  addEventListener('pageshow', () => { disposed = false; connect(); });
  connect(); return { clock, report };
}
