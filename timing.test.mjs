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

