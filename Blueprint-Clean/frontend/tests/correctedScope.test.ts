import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewMeasurementEdit } from '../utils/measurementEdit.ts';
import { buildMotionInsertion } from '../utils/motionInsertion.ts';
import { inspectProgramSettings } from '../utils/programSettings.ts';

test('measurement draft shows exact endpoint and preserves source until Apply', () => {
  const lines = ['G21 G90', 'G00 X10 Y20', 'G01 X30 Y40 ; keep'];
  const original = [...lines];
  const draft = reviewMeasurementEdit(lines, 2, { X: '31.123456', Y: '42' });
  assert.equal(draft.end.x, 31.123456);
  assert.equal(draft.end.y, 42);
  assert.equal(draft.start.x, 10);
  assert.equal(draft.dy, 22);
  assert.equal(draft.source, 'G01 X31.123456 Y42 ; keep');
  assert.deepEqual(lines, original);
  assert.deepEqual(draft.updated.slice(0, 2), original.slice(0, 2));
});

test('measurement draft resolves source increments to numeric endpoint', () => {
  const draft = reviewMeasurementEdit(['G90', 'G00 X10 Y20', 'G91', 'G01 X2 Y3'], 3, { X: '4', Y: '6' });
  assert.equal(draft.end.x, 14);
  assert.equal(draft.end.y, 26);
  assert.equal(draft.dx, 4);
  assert.throws(() => reviewMeasurementEdit(['M5'], 0, {}), /No supported XY/);
  assert.throws(() => reviewMeasurementEdit(['G01 X1 Y2'], 0, { X: 'invalid' }));
});

test('pierce cannot generate commands even when called outside UI', () => {
  assert.throws(() => buildMotionInsertion('pierce', { endX: 1, endY: 2 }, {
    units: 'mm', distance: 'absolute', arcCenter: 'incremental', plane: 'XY', start: { x: 0, y: 0 },
  }), /Unsupported until a verified controller profile is available\./);
});

test('all requested process categories are explicit without inferred vendor values', () => {
  const lines = ['G21 G94 F120', '(170 amp nozzle 4 pierce 2)', 'M3 S170 T4 H2 P3 Q6'];
  const original = [...lines];
  const result = inspectProgramSettings(lines);
  assert.match(result.feed[0].description, /120 mm\/min/);
  for (const key of ['amperage', 'nozzle', 'heightControl', 'pierce', 'overburn'] as const) {
    assert.match(result[key], /Unsupported until a verified controller profile/);
  }
  assert.ok(result.unresolved.some(entry => entry.raw === 'S170' && entry.line === 3));
  assert.ok(result.unresolved.every(entry => entry.line !== 2));
  assert.equal(inspectProgramSettings(['M5']).feed.length, 0);
  assert.deepEqual(lines, original);
});
