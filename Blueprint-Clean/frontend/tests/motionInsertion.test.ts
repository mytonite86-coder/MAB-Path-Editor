import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMotionInsertion, validateInsertionIndex } from '../utils/motionInsertion.ts';

const context = { units: 'mm' as const, distance: 'absolute' as const, arcCenter: 'incremental' as const, plane: 'XY' as const, start: { x: -10, y: 5 } };

test('typed line and rapid candidates preserve signed absolute endpoints', () => {
  assert.deepEqual(buildMotionInsertion('line', { endX: -25, endY: 15 }, context).lines, ['G01 X-25 Y15\n']);
  assert.deepEqual(buildMotionInsertion('rapid', { endX: 0, endY: -2 }, context, '\r\n').lines, ['G00 X0 Y-2\r\n']);
});

test('arc candidates honor incremental center coordinates and endpoint mode', () => {
  const result = buildMotionInsertion('arc-cw', { endX: 2, endY: 7, centerX: -4, centerY: 6 }, context);
  assert.deepEqual(result.lines, ['G02 X2 Y7 I6 J1\n']);
});

test('candidate rejects invalid circle, zero length, unknown modes and sub-resolution coordinates', () => {
  assert.throws(() => buildMotionInsertion('arc-cw', { endX: 1, endY: 1, centerX: 0, centerY: 0 }, context), /same nonzero/);
  assert.throws(() => buildMotionInsertion('line', { endX: -10, endY: 5 }, context), /Zero-length/);
  assert.throws(() => buildMotionInsertion('line', { endX: NaN, endY: 0 }, context), /finite/);
  assert.throws(() => buildMotionInsertion('line', { endX: 1e-9, endY: 0 }, context), /no rounding/);
  assert.throws(() => buildMotionInsertion('line', { endX: 1, endY: 0 }, { ...context, units: undefined } as unknown as typeof context), /Explicit/);
  assert.equal(buildMotionInsertion('line', { endX: -0.1234567, endY: 0 }, context).lines[0], 'G01 X-0.1234567 Y0\n');
});

test('incremental endpoints and absolute centers are independent', () => {
  const result = buildMotionInsertion('arc-ccw', { endX: 2, endY: 7, centerX: -4, centerY: 6 }, { ...context, distance: 'incremental', arcCenter: 'absolute' });
  assert.equal(result.lines[0], 'G03 X12 Y2 I-4 J6\n');
});

test('unsupported lead candidates and invalid insertion points stay gated', () => {
  assert.throws(() => buildMotionInsertion('lead-in', { endX: 1, endY: 1 }, context), /contour and process/);
  assert.throws(() => buildMotionInsertion('arc-ccw', { endX: 1, endY: 1 }, context), /center/);
  assert.throws(() => validateInsertionIndex(['G01 X1'], 2.5), /outside/);
  assert.doesNotThrow(() => validateInsertionIndex(['G01 X1'], 1));
});
