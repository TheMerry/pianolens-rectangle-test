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
  if (!notes.length) return [{ at: -Infinity, low: 48 }];
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
  const plan = [{ at: -Infinity, low }];
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
        plan.push({ at: safeAt, low: next });
        low = next;
      }
    }
    for (const n of current) heldEnd = Math.max(heldEnd, n[1] + n[2]);
  }
  return plan;
}
function windowAt(plan, time) {
  let index = 0;
  while (index + 1 < plan.length && plan[index + 1].at <= time) index++;
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
export {
  KEY_HEIGHT,
  KEY_TOP,
  LOOKAHEAD_MS,
  LessonClock,
  LessonReceiver,
  MAX_NOTES,
  STRIKE_Y,
  WHITE_KEYS,
  noteRect,
  planWindows,
  validLessonPacket,
  validState,
  visibleKeys,
  windowAt
};
