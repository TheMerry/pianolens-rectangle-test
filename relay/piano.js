/*! Reuses React Piano Roll keyboard utilities.
MIT License

Copyright (c) 2025 Minagishl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// web/vendor/piano-roll/utils/piano.ts
function isBlackKey(midiNote) {
  const noteInOctave = midiNote % 12;
  return [1, 3, 6, 8, 10].includes(noteInOctave);
}
function getNoteNameFromMIDI(midiNote) {
  const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midiNote / 12) - 1;
  const noteName = noteNames[midiNote % 12];
  return `${noteName}${octave}`;
}
function getKeyXPosition(midiNote, startNote, whiteKeyWidth) {
  let whiteKeyCount = 0;
  for (let note = startNote; note < midiNote; note++) {
    if (!isBlackKey(note)) {
      whiteKeyCount++;
    }
  }
  return whiteKeyCount * whiteKeyWidth;
}

// web/hybrid/lesson.ts
var WHITE_KEYS = 20;
var STRIKE_Y = 518;
var KEY_TOP = 520;
var KEY_HEIGHT = 80;
var LOOKAHEAD_MS = 4e3;
var MAX_NOTES = 2e4;
var whitePitches = Array.from({ length: 88 }, (_, i) => i + 21).filter((p) => !isBlackKey(p));
function visibleKeys(low) {
  const first = whitePitches.indexOf(low);
  if (first < 0 || first > whitePitches.length - WHITE_KEYS) throw Error("Invalid 20-white-key window");
  const high = whitePitches[first + WHITE_KEYS - 1], w = 600 / WHITE_KEYS;
  return Array.from({ length: high - low + 1 }, (_, i) => {
    const pitch = low + i, black = isBlackKey(pitch), width = w * (black ? 0.6 : 1);
    return { pitch, black, width, x: getKeyXPosition(pitch, low, w) - (black ? width / 2 : 0), label: pitch % 12 === 0 ? getNoteNameFromMIDI(pitch) : "" };
  });
}
function chooseWindow(pitches, previous, required = []) {
  let best = 0, score = -Infinity;
  const previousIndex = previous === void 0 ? void 0 : whitePitches.indexOf(previous);
  for (let i = 0; i <= whitePitches.length - WHITE_KEYS; i++) {
    const low = whitePitches[i], high = whitePitches[i + WHITE_KEYS - 1], inside = pitches.filter((p) => p >= low && p <= high);
    const centre = inside.length ? inside.reduce((a, b) => a + b, 0) / inside.length : 60;
    const padding = inside.length ? Math.min(...inside.map((p) => Math.min(p - low, high - p))) : 0;
    const chunk = previousIndex !== void 0 && Math.abs(i - previousIndex) % 7 === 0 ? 5 : 0;
    const value = required.filter((p) => p >= low && p <= high).length * 1e9 + inside.length * 1e4 + Math.min(padding, 3) * 8 - Math.abs((low + high) / 2 - centre) + chunk - (previousIndex === void 0 ? 0 : Math.abs(i - previousIndex) * 0.15);
    if (value > score) {
      best = i;
      score = value;
    }
  }
  return whitePitches[best];
}
function planWindows(notes, groups) {
  if (!notes.length) return [{ at: -Infinity, low: 48, forGroup: 0 }];
  const byGroup = groups.map(() => []);
  for (const n of notes) byGroup[n[4]]?.push(n);
  const upcoming = (i) => {
    const pitches = [];
    for (let j = i; j < groups.length && groups[j] <= groups[i] + 2e3 && pitches.length < 128; j++) for (const n of byGroup[j]) {
      pitches.push(n[0]);
      if (pitches.length >= 128) break;
    }
    return pitches;
  };
  let low = chooseWindow(upcoming(0), void 0, byGroup[0]?.map((n) => n[0]) ?? []), heldEnd = 0;
  const plan = [{ at: -Infinity, low, forGroup: 0 }];
  for (let i = 0; i < groups.length; i++) {
    const current = byGroup[i], high = visibleKeys(low).at(-1).pitch;
    if (current.some((n) => n[0] < low || n[0] > high)) {
      const next = chooseWindow(upcoming(i), low, current.map((n) => n[0]));
      if (next !== low) {
        const gap = groups[i] - heldEnd;
        const at = gap >= 350 ? heldEnd + gap / 2 : groups[i] - 1250;
        if (plan.length > 1 && at - plan.at(-1).at < 3e3) {
          for (const n of current) heldEnd = Math.max(heldEnd, n[1] + n[2]);
          continue;
        }
        const safeAt = Math.max(plan.at(-1).at, at);
        if (plan.at(-1).at === safeAt) plan.pop();
        plan.push({ at: safeAt, low: next, forGroup: i });
        low = next;
      }
    }
    for (const n of current) heldEnd = Math.max(heldEnd, n[1] + n[2]);
  }
  return plan;
}
function windowAt(plan, time, expectedIndex) {
  let index = 0;
  while (index + 1 < plan.length && plan[index + 1].at <= time && (expectedIndex === void 0 || plan[index + 1].forGroup <= expectedIndex)) index++;
  return plan[index].low;
}
function noteRect(note, low, positionMs, keys = visibleKeys(low)) {
  const key = keys.find((k) => k.pitch === note[0]);
  if (!key) return null;
  const bottom = STRIKE_Y - (note[1] - positionMs) * STRIKE_Y / LOOKAHEAD_MS;
  return { x: key.x + 1, width: key.width - 2, top: bottom - Math.max(6, note[2] * STRIKE_Y / LOOKAHEAD_MS), bottom };
}
var finite = (x) => typeof x === "number" && Number.isFinite(x);
var integer = (x, min, max) => Number.isInteger(x) && Number(x) >= min && Number(x) <= max;
var id = (x) => typeof x === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(x);
function validState(m) {
  return !!m && m.v === 2 && ["lessonState", "correctChord"].includes(m.type) && id(m.songId) && integer(m.epoch, 0, 1e12) && integer(m.revision, 0, 1e12) && finite(m.positionMs) && Math.abs(m.positionMs) <= 864e5 && finite(m.speed) && m.speed >= 0.25 && m.speed <= 1.5 && typeof m.playing === "boolean" && typeof m.waiting === "boolean" && ["wait", "continuous"].includes(m.mode) && integer(m.expectedIndex, 0, MAX_NOTES) && m.confirmedThrough === m.expectedIndex - 1 && finite(m.sentAt) && typeof m.showKeyboard === "boolean" && (m.type !== "correctChord" || m.chordIndex === m.expectedIndex - 1);
}
function validLessonPacket(m) {
  if (!m || !integer(m.packetId, 1, 1e12) || !id(m.songId)) return false;
  if (validState(m)) return true;
  if (m.type === "loadSong") return m.v === 2 && typeof m.title === "string" && m.title.length <= 120 && integer(m.count, 0, MAX_NOTES) && integer(m.groupCount, 0, MAX_NOTES) && finite(m.endMs) && m.endMs >= 0 && m.endMs <= 864e5;
  if (m.type === "songChunk") return integer(m.offset, 0, MAX_NOTES) && Array.isArray(m.notes) && m.notes.length > 0 && m.notes.length <= 64 && m.notes.every((n) => Array.isArray(n) && n.length === 5 && integer(n[0], 21, 108) && finite(n[1]) && n[1] >= 0 && n[1] <= 864e5 && finite(n[2]) && n[2] > 0 && n[2] <= 864e5 && [0, 1].includes(n[3]) && integer(n[4], 0, MAX_NOTES - 1));
  return false;
}
var LessonReceiver = class {
  lesson = null;
  loading = null;
  accept(m) {
    if (!validLessonPacket(m)) return false;
    if (m.type === "loadSong") {
      this.loading = { ...m, notes: [] };
      if (m.count === 0) {
        if (m.groupCount !== 0) return false;
        this.lesson = { ...m, notes: [], groups: [], windows: planWindows([], []) };
        this.loading = null;
      }
      return true;
    }
    if (m.type === "songChunk") {
      const l = this.loading;
      if (!l || m.songId !== l.songId || m.offset !== l.notes.length || m.offset + m.notes.length > l.count) return false;
      l.notes.push(...m.notes);
      if (l.notes.length === l.count) {
        const groups = [];
        let previous = -1;
        for (const n of l.notes) {
          if (n[1] < previous || n[4] > groups.length) return false;
          if (n[4] === groups.length) groups.push(n[1]);
          previous = n[1];
        }
        if (groups.length !== l.groupCount) return false;
        this.lesson = { songId: l.songId, title: l.title, notes: l.notes, groups, endMs: l.endMs, windows: planWindows(l.notes, groups) };
        this.loading = null;
      }
      return true;
    }
    return true;
  }
  get loaded() {
    return !this.loading && this.lesson !== null;
  }
};
var LessonClock = class {
  state = null;
  position = 0;
  anchor = 0;
  connected = false;
  apply(m, lesson, now, ageMs = 0) {
    if (!validState(m) || m.songId !== lesson.songId || m.expectedIndex > lesson.groups.length) return false;
    const s = this.state;
    if (s && s.songId === m.songId && (m.epoch < s.epoch || m.epoch === s.epoch && (m.revision <= s.revision || m.expectedIndex < s.expectedIndex))) return false;
    this.state = { ...m };
    this.anchor = now;
    this.position = m.positionMs;
    if (m.playing && !m.waiting) this.position += Math.max(0, Math.min(1e3, ageMs)) * m.speed;
    this.connected = true;
    this.position = this.clamp(this.position, lesson);
    return true;
  }
  clamp(value, lesson) {
    if (this.state?.mode === "wait" && this.state.expectedIndex < lesson.groups.length) value = Math.min(value, lesson.groups[this.state.expectedIndex]);
    return Math.min(lesson.endMs, value);
  }
  value(now, lesson) {
    const s = this.state;
    return this.clamp(this.position + (this.connected && s?.playing && !s.waiting ? Math.max(0, now - this.anchor) * s.speed : 0), lesson);
  }
  frozenAtTarget(now, lesson) {
    const s = this.state;
    return s?.mode === "wait" && s.expectedIndex < lesson.groups.length && (s.waiting || this.value(now, lesson) >= lesson.groups[s.expectedIndex]);
  }
  freeze(now, lesson) {
    if (lesson) this.position = this.value(now, lesson);
    this.anchor = now;
    this.connected = false;
  }
  get online() {
    return this.connected;
  }
};

// web/hybrid/canvas.ts
var PianoCanvas = class {
  constructor(canvas2) {
    this.canvas = canvas2;
    this.cache = document.createElement("canvas");
    this.cache.width = 600;
    this.cache.height = KEY_HEIGHT;
  }
  low = -1;
  keys = visibleKeys(48);
  cache;
  prefixEnd = [];
  groupPitches = [];
  song = null;
  draw(lesson, clock2, now, status2, diagnostics2) {
    const ctx2 = this.canvas.getContext("2d", { alpha: false });
    const time = clock2.value(now, lesson), s = clock2.state, low = windowAt(lesson.windows, time, s?.mode === "wait" ? s.expectedIndex : void 0);
    if (this.song !== lesson) {
      let end = -Infinity;
      this.prefixEnd = lesson.notes.map((n) => end = Math.max(end, n[1] + n[2]));
      this.groupPitches = lesson.groups.map(() => []);
      for (const n of lesson.notes) this.groupPitches[n[4]].push(n[0]);
      this.song = lesson;
    }
    if (low !== this.low) {
      this.low = low;
      this.keys = visibleKeys(low);
      const c = this.cache.getContext("2d", { alpha: false });
      c.fillStyle = "#000";
      c.fillRect(0, 0, 600, KEY_HEIGHT);
      for (const black of [false, true]) for (const key of this.keys.filter((k) => k.black === black)) {
        c.fillStyle = black ? "#111" : "#c9c9c9";
        c.fillRect(key.x + 1, 0, key.width - 2, black ? 48 : KEY_HEIGHT);
        c.strokeStyle = black ? "#aaa" : "#555";
        c.strokeRect(key.x + 1, 0.5, key.width - 2, black ? 48 : KEY_HEIGHT - 1);
        if (key.label) {
          c.fillStyle = "#222";
          c.font = "11px sans-serif";
          c.textAlign = "center";
          c.fillText(key.label, key.x + key.width / 2, KEY_HEIGHT - 8);
        }
      }
    }
    ctx2.fillStyle = "#000";
    ctx2.fillRect(0, 0, 600, 600);
    const waiting = clock2.frozenAtTarget(now, lesson), expected = new Set(this.groupPitches[s?.expectedIndex ?? -1] ?? []);
    const active = /* @__PURE__ */ new Set();
    let a = 0, b = this.prefixEnd.length;
    while (a < b) {
      const mid = a + b >> 1;
      if (this.prefixEnd[mid] < time) a = mid + 1;
      else b = mid;
    }
    let left = false, right = false;
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(0, 0, 600, STRIKE_Y);
    ctx2.clip();
    for (let i = a; i < lesson.notes.length; i++) {
      const note = lesson.notes[i];
      if (note[1] > time + LOOKAHEAD_MS) break;
      if (note[1] + note[2] < time) continue;
      if (note[1] <= time && note[1] + note[2] > time) active.add(note[0]);
      const drawNote = waiting && note[4] === s?.expectedIndex ? [note[0], lesson.groups[note[4]], note[2], note[3], note[4]] : note;
      const r = noteRect(drawNote, low, time, this.keys);
      if (!r) {
        left ||= note[0] < low;
        right ||= note[0] > this.keys.at(-1).pitch;
        continue;
      }
      ctx2.fillStyle = s?.mode === "wait" && note[4] === s.expectedIndex && waiting ? "#ffcc66" : note[3] === 0 ? "#b8a7ff" : "#70d8fc";
      ctx2.fillRect(r.x, r.top, r.width, Math.max(4, r.bottom - r.top));
    }
    ctx2.restore();
    ctx2.fillStyle = waiting ? "#ffcc66" : "#fff";
    ctx2.fillRect(0, STRIKE_Y, 600, 2);
    if (s?.showKeyboard !== false) {
      ctx2.drawImage(this.cache, 0, KEY_TOP);
      const highlights = s?.mode === "wait" ? expected : active;
      for (const black of [false, true]) for (const key of this.keys.filter((k) => k.black === black)) {
        if (highlights.has(key.pitch)) {
          ctx2.fillStyle = waiting ? "#ffcc66" : s?.mode === "wait" ? "#b9a577" : "#74e6ba";
          ctx2.fillRect(key.x + 2, KEY_TOP + 1, key.width - 4, black ? 46 : KEY_HEIGHT - 2);
        } else if (black) {
          ctx2.fillStyle = "#111";
          ctx2.fillRect(key.x + 1, KEY_TOP, key.width - 2, 48);
          ctx2.strokeStyle = "#aaa";
          ctx2.strokeRect(key.x + 1, KEY_TOP + 0.5, key.width - 2, 48);
        }
        if (!black && key.label) {
          ctx2.fillStyle = "#222";
          ctx2.textAlign = "center";
          ctx2.font = "11px sans-serif";
          ctx2.fillText(key.label, key.x + key.width / 2, 592);
        }
      }
    }
    ctx2.fillStyle = "#ddd";
    ctx2.font = "14px sans-serif";
    ctx2.textAlign = "left";
    ctx2.fillText(lesson.title, 8, 20, 400);
    ctx2.textAlign = "right";
    ctx2.fillText(`${Math.round((s?.speed ?? 1) * 100)}%`, 592, 20);
    ctx2.textAlign = "center";
    ctx2.fillStyle = waiting ? "#ffcc66" : "#eee";
    ctx2.font = "16px sans-serif";
    const indicator = !clock2.online ? "Disconnected \xB7 frozen" : !s?.playing ? "Paused" : waiting ? "PLAY TO CONTINUE" : s.mode === "wait" ? "Practice" : "Listen";
    ctx2.fillText(status2 || indicator, 300, 44, 580);
    ctx2.font = "23px sans-serif";
    if (left) ctx2.fillText("\u25C0", 12, STRIKE_Y - 12);
    if (right) ctx2.fillText("\u25B6", 588, STRIKE_Y - 12);
    if (diagnostics2) {
      ctx2.font = "12px monospace";
      ctx2.fillStyle = "#ddd";
      ctx2.fillText(diagnostics2, 300, 70, 580);
    }
    this.canvas.dataset.lesson = JSON.stringify({ songId: lesson.songId, positionMs: time, mode: s?.mode, waiting, expectedIndex: s?.expectedIndex, low, high: this.keys.at(-1).pitch, whiteKeys: 20, keyStripHeight: KEY_HEIGHT, strikeY: STRIKE_Y });
  }
};

// web/hybrid/viewer.ts
var canvas = document.getElementById("display");
var ctx = canvas.getContext("2d", { alpha: false });
var renderer = new PianoCanvas(canvas);
var receiver = new LessonReceiver();
var clock = new LessonClock();
var socket = null;
var credentials = null;
var code = null;
var status = "Connecting\u2026";
var paired = false;
var retry;
var deadline;
var pairExpiry;
var attempt = 0;
var raf = 0;
var lastDraw = -Infinity;
var dirty = true;
var diagnostics = false;
var lastState = 0;
var offset = null;
var ping = null;
var started = performance.now();
var lastFrame = 0;
var lastSample = started;
var sampleDraws = 0;
var metrics = { build: "piano-C1", draws: 0, drawFps: 0, rafCallbacks: 0, longFrames50Ms: 0, longFrames100Ms: 0, drawCpuTotalMs: 0, drawCpuMaxMs: 0, acknowledged: 0, rejected: 0, reconnects: 0, lastCloseCode: null, lastPingRoundTripMs: null, lastStateAgeEstimateMs: null, opticalFps: null };
var storageKey = "pianolens.piano.viewer.v1";
try {
  credentials = JSON.parse(localStorage.getItem(storageKey) || "null");
} catch {
}
var clearCredentials = () => {
  credentials = null;
  try {
    localStorage.removeItem(storageKey);
  } catch {
  }
};
function mark(value) {
  status = value;
  canvas.setAttribute("aria-label", `PianoLens piano lesson. ${value}${code ? ". Pairing code " + code.slice(0, 4) + "-" + code.slice(4) : ""}. Select for diagnostics or new pairing.`);
  dirty = true;
  wake();
}
function freeze() {
  clock.freeze(performance.now(), receiver.lesson);
  dirty = true;
  wake();
}
function write(m) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m));
}
function connect() {
  if (document.hidden || socket) return;
  mark("Connecting\u2026");
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rectangle`);
  socket = ws;
  paired = false;
  deadline = setTimeout(() => {
    if (socket === ws) ws.close();
  }, 7e4);
  ws.onopen = () => {
    if (socket === ws) {
      clearTimeout(deadline);
      deadline = setTimeout(() => {
        if (socket === ws) ws.close();
      }, 1e4);
      write(credentials ? { type: "reconnect", role: "viewer", ...credentials } : { type: "create", kind: "piano" });
    }
  };
  ws.onmessage = ({ data }) => {
    if (socket !== ws || typeof data !== "string" || data.length > 4096) return;
    let m;
    try {
      m = JSON.parse(data);
    } catch {
      return;
    }
    if (m.type === "created") {
      credentials = { roomId: m.roomId, secret: m.secret };
      code = m.code;
      attempt = 0;
      clearTimeout(deadline);
      clearTimeout(pairExpiry);
      pairExpiry = setTimeout(() => {
        if (!paired) freshPair();
      }, Math.max(1e3, Math.min(12e4, m.expiresInMs || 12e4)));
      try {
        localStorage.setItem(storageKey, JSON.stringify(credentials));
      } catch {
      }
      mark("Enter this code on your phone");
    } else if (m.type === "restored") {
      code = m.code;
      attempt = 0;
      clearTimeout(deadline);
      mark(m.paired ? "Waiting for phone" : "Enter this code on your phone");
    } else if (m.type === "paired") {
      paired = true;
      code = null;
      clearTimeout(pairExpiry);
      offset = null;
      lastState = performance.now();
      mark("Restoring lesson\u2026");
      ping = { id: String(Date.now()), wall: Date.now(), mono: performance.now() };
      write({ type: "ping", id: ping.id });
      write({ type: "snapshot" });
    } else if (m.type === "peerDisconnected") {
      paired = false;
      freeze();
      mark("Phone disconnected \xB7 Select to pair again");
    } else if (m.type === "pong" && ping && m.id === ping.id && Number.isFinite(m.serverUnixMs)) {
      const rtt = performance.now() - ping.mono;
      metrics.lastPingRoundTripMs = rtt;
      offset = m.serverUnixMs - (ping.wall + rtt / 2);
      ping = null;
    } else if (receiver.accept(m)) {
      const now = performance.now();
      if (m.type === "loadSong") {
        freeze();
        mark("Loading lesson\u2026");
      }
      if (m.type === "lessonState" || m.type === "correctChord") {
        const age = offset === null ? 0 : Math.max(0, Date.now() + offset - m.sentAt);
        if (!receiver.loaded || !clock.apply(m, receiver.lesson, now, age)) {
          metrics.rejected++;
          write({ type: "snapshot" });
          return;
        }
        metrics.lastStateAgeEstimateMs = offset === null ? null : age;
        lastState = now;
        mark("");
      }
      write({ type: "lessonAck", packetId: m.packetId });
      metrics.acknowledged++;
      dirty = true;
      wake();
    } else {
      metrics.rejected++;
      write({ type: "snapshot" });
    }
  };
  ws.onerror = () => mark("Connection error \xB7 retrying");
  ws.onclose = ({ code: closeCode }) => {
    if (socket !== ws) return;
    socket = null;
    clearTimeout(deadline);
    paired = false;
    code = null;
    metrics.lastCloseCode = closeCode;
    freeze();
    if (closeCode === 4008) {
      clearCredentials();
      code = null;
      mark("Pairing expired \xB7 getting new code");
    } else if (closeCode === 4003 || closeCode === 4004) {
      mark("Pairing rejected \xB7 Select to get a new code");
      return;
    } else mark("Disconnected \xB7 frozen");
    if (!document.hidden) {
      metrics.reconnects++;
      retry = setTimeout(connect, Math.min(3e4, 1e3 * 2 ** Math.min(attempt++, 5)) + Math.random() * 250);
    }
  };
}
function paint(now) {
  raf = 0;
  if (document.hidden) return;
  metrics.rafCallbacks++;
  const moving = !!(receiver.loaded && clock.online && clock.state?.playing && !clock.frozenAtTarget(now, receiver.lesson) && clock.value(now, receiver.lesson) < receiver.lesson.endMs);
  if (dirty || moving && now - lastDraw >= 1e3 / 30 - 0.5) {
    const at = performance.now();
    if (moving && lastFrame) {
      const dt = now - lastFrame;
      if (dt > 50) metrics.longFrames50Ms++;
      if (dt > 100) metrics.longFrames100Ms++;
    }
    lastFrame = moving ? now : 0;
    if (!code && receiver.loaded && clock.state?.songId === receiver.lesson?.songId) {
      renderer.draw(receiver.lesson, clock, now, status, diagnostics ? `${metrics.drawFps.toFixed(1)} fps \xB7 CPU max ${metrics.drawCpuMaxMs.toFixed(1)}ms \xB7 ACK ${metrics.acknowledged}` : void 0);
    } else {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, 600, 600);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.font = "22px sans-serif";
      ctx.fillText(status, 300, 90, 560);
      if (code) {
        ctx.font = "bold 48px monospace";
        ctx.fillText(code.slice(0, 4) + "\u2013" + code.slice(4), 300, 165);
        ctx.font = "20px sans-serif";
        ctx.fillText("PianoLens phone \u2192 Glasses piano lesson", 300, 215, 560);
      }
    }
    const cpu = performance.now() - at;
    metrics.drawCpuTotalMs += cpu;
    metrics.drawCpuMaxMs = Math.max(metrics.drawCpuMaxMs, cpu);
    metrics.draws++;
    sampleDraws++;
    lastDraw = now;
    dirty = false;
  }
  if (moving) raf = requestAnimationFrame(paint);
}
function wake() {
  if (!document.hidden && !raf) raf = requestAnimationFrame(paint);
}
function suspend() {
  clearTimeout(retry);
  clearTimeout(deadline);
  clearTimeout(pairExpiry);
  const old = socket;
  socket = null;
  old?.close(1e3, "Viewer hidden");
  freeze();
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}
function freshPair() {
  clearCredentials();
  code = null;
  clearTimeout(pairExpiry);
  clearTimeout(retry);
  clearTimeout(deadline);
  if (socket) {
    const old = socket;
    socket = null;
    old.close();
  }
  connect();
}
canvas.addEventListener("click", () => {
  if (!paired) freshPair();
  else {
    diagnostics = !diagnostics;
    dirty = true;
    wake();
  }
});
canvas.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    canvas.click();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend();
  else {
    connect();
    dirty = true;
    wake();
  }
});
addEventListener("pagehide", suspend);
addEventListener("pageshow", () => {
  connect();
  wake();
});
setInterval(() => {
  if (document.hidden) return;
  const now = performance.now();
  if (clock.online && now - lastState > 5500) {
    freeze();
    mark("Connection stale \xB7 frozen");
    write({ type: "snapshot" });
  }
  if (now - lastSample >= 1e3) {
    metrics.drawFps = sampleDraws * 1e3 / (now - lastSample);
    sampleDraws = 0;
    lastSample = now;
    canvas.dataset.connection = JSON.stringify({ ...metrics, elapsedMs: now - started, status, paired, loaded: receiver.loaded });
    if (diagnostics) {
      dirty = true;
      wake();
    }
  }
}, 250);
connect();
wake();
