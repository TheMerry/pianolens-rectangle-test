import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangleAt, VisibleClock, Cadence, Distribution, drawBucket } from './timing.js';

test('rectangle depends only on elapsed time even after dropped animation frames', () => {
  assert.equal(rectangleAt(1000).y,168);
  assert.equal(rectangleAt(3400).y,456);
  assert.equal(rectangleAt(6800).y,48);
  assert.equal(rectangleAt(6000).y,144);
  for(let t=0;t<60000;t+=73) { const r=rectangleAt(t); assert.ok(r.y>=48 && r.y+r.height<=552); }
});
test('hidden time does not change motion and duplicate pause/resume is harmless', () => {
  const clock=new VisibleClock(100); clock.pause(1100); clock.pause(1200);
  assert.equal(clock.value(100000),1000); clock.resume(100000); clock.resume(100001);
  assert.equal(clock.value(100500),1500);
});
test('30 Hz cap skips slots without a catch-up queue; native RAF has no cap', () => {
  assert.equal(drawBucket(0,30),0); assert.equal(drawBucket(16,30),0);
  assert.equal(drawBucket(34,30),1); assert.equal(drawBucket(5034,30),151);
  assert.equal(drawBucket(34,null),null);
});
test('cadence retains foreground stalls but excludes a declared hidden segment', () => {
  const c=new Cadence(); c.record(0); c.record(33); c.record(5033);
  c.breakSegment(); c.record(50000); c.record(50033);
  const r=c.summary(10); assert.equal(r.gapsOver1000Ms,1); assert.equal(r.intervals.samples,3);
  assert.equal(r.intervals.maxMs,5000); assert.equal(r.callbacks,5);
});
test('distribution has bounded storage and preserves large-stall maximum', () => {
  const d=new Distribution(); for(let i=0;i<10000;i++)d.add(33.3); d.add(5010);
  assert.equal(d.bins.length,2001); assert.equal(d.summary().maxMs,5010);
  assert.equal(d.summary().p95BucketLowerMs,33); assert.equal(d.summary().samples,10001);
});


import { CommandClock, validateEndpoint } from './commands.js';
const msg = (revision, more = {}) => ({ v: 1, type: 'state', sessionId: 'test', revision, positionMs: 1000, playing: true, speed: 1, ...more });
test('start, pause, resume, speed and reset use authoritative anchors', () => {
  const c = new CommandClock();
  assert.ok(c.apply(msg(1, { type: 'start', positionMs: 0 }), 0)); assert.equal(c.value(1000), 1000);
  c.apply(msg(2, { type: 'pause', playing: false }), 1000); assert.equal(c.value(5000), 1000);
  c.apply(msg(3, { type: 'resume' }), 5000); assert.equal(c.value(6000), 2000);
  c.apply(msg(4, { type: 'speed', positionMs: 2000, speed: .5 }), 6000); assert.equal(c.value(8000), 3000);
  c.apply(msg(5, { type: 'reset', positionMs: 0, playing: false }), 8000); assert.equal(c.value(9000), 0);
});
test('duplicate, reordered and invalid commands cannot alter the clock', () => {
  const c = new CommandClock(); c.apply(msg(5), 100);
  for (const m of [msg(4), msg(5), msg(6, { speed: 2 }), msg(6, { positionMs: NaN }), msg(6, { type: 'loadSong' })]) assert.equal(c.apply(m, 1000), false);
  assert.equal(c.value(1100), 2000);
});
test('disconnect freezes; reconnect accepts fresh state or a new phone session', () => {
  const c = new CommandClock(); c.apply(msg(5), 100); c.freeze(600); assert.equal(c.value(10000), 1500);
  assert.ok(c.apply(msg(6, { positionMs: 5000 }), 10000)); assert.equal(c.value(11000), 6000);
  assert.ok(c.apply(msg(0, { sessionId: 'new', playing: false }), 11000)); assert.equal(c.value(12000), 1000);
});
test('transit compensation is bounded and never moves paused state', () => {
  const c = new CommandClock(); c.apply(msg(1), 0, 100); assert.equal(c.value(0), 1100);
  c.apply(msg(2, { playing: false }), 0, 100); assert.equal(c.value(0), 1000);
});
test('endpoint validation rejects external plaintext endpoints and embedded credentials', () => {
  for (const host of ['127.0.0.1', '10.0.0.2', '172.16.0.2', '192.168.1.2']) assert.ok(validateEndpoint(`ws://${host}:8765/rectangle`));
  assert.ok(validateEndpoint('wss://phone.example/rectangle'));
  for (const url of ['http://localhost/rectangle', 'ws://8.8.8.8/rectangle', 'ws://172.32.0.1/rectangle', 'wss://x:y@phone.example/rectangle', 'wss://phone.example/rectangle?token=x']) assert.throws(() => validateEndpoint(url));
});

