import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpretToolpath, motionSemantics } from '../utils/gcodeDocument.ts';

test('classifies arcs as Cut geometry subtypes and preserves straight and rapid roles', () => {
  assert.deepEqual(motionSemantics('G00'), { role: 'rapid', geometry: 'straight' });
  assert.deepEqual(motionSemantics('G01'), { role: 'cut', geometry: 'straight' });
  assert.deepEqual(motionSemantics('G02'), { role: 'cut', geometry: 'arc-cw' });
  assert.deepEqual(motionSemantics('G03'), { role: 'cut', geometry: 'arc-ccw' });
});

test('renders a full-circle G03 as a counterclockwise arc with the commanded endpoint', () => {
  const points = interpretToolpath(['G00 X0 Y0', 'G03 X0 Y0 I1 J0']);
  const arc = points.filter(point => point.mode === 'G03');
  assert.ok(arc.length >= 12);
  assert.ok(new Set(arc.map(point => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)).size > 8);
  assert.equal(arc[0].role, 'cut');
  assert.equal(arc[0].geometry, 'arc-ccw');
  const center = { x: 1, y: 0 };
  const startRadius = { x: -1, y: 0 };
  const firstRadius = { x: arc[0].x - center.x, y: arc[0].y - center.y };
  assert.ok(startRadius.x * firstRadius.y - startRadius.y * firstRadius.x > 0);
  assert.ok(Math.abs(arc.at(-1)!.x) < 1e-9);
  assert.ok(Math.abs(arc.at(-1)!.y) < 1e-9);
  assert.equal(arc.at(-1)!.commandEnd, true);
});

test('preserves clockwise arc direction and marks Pierce before Cut geometry', () => {
  const points = interpretToolpath(['G00 X0 Y0', 'G02 X2 Y0 I1 J0']);
  const arc = points.filter(point => point.mode === 'G02');
  assert.ok(arc.length >= 12);
  assert.equal(arc[0].pierce, true);
  assert.equal(arc[0].role, 'cut');
  assert.equal(arc[0].geometry, 'arc-cw');
  assert.ok(arc[0].y > 0);
  assert.ok(Math.abs(arc.at(-1)!.x - 2) < 1e-9);
  assert.ok(Math.abs(arc.at(-1)!.y) < 1e-9);
});
