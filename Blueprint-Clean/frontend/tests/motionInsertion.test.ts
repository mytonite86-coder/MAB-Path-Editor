import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMotionInsertion, validateInsertionIndex } from '../utils/motionInsertion.ts';

const context = { units: 'mm' as const, distance: 'absolute' as const, arcCenter: 'incremental' as const, plane: 'XY' as const, start: { x: -10, y: 5 } };

test('typed line and rapid candidates preserve signed absolute endpoints', () => {
  assert.deepEqual(buildMotionInsertion('line', { endX: -25, endY: 15 }, context).lines, ['G01 X-25 Y15\n']);
  assert.deepEqual(buildMotionInsertion('rapid', { endX: 0, endY: -2 }, context, '\r\n').lines, ['G00 X0 Y-2\r\n']);
});

test('arc candidates honor incremental center coordinates and endpoint mode', () => {
  const result = buildMotionInsertion('arc-cw', { endX: -2.5, endY: 8, centerX: -4, centerY: 6 }, context);
  assert.deepEqual(result.lines, ['G02 X-2.5 Y8 I6 J1\n']);
});

test('unsupported lead candidates and invalid insertion points stay gated', () => {
  assert.throws(() => buildMotionInsertion('lead-in', { endX: 1, endY: 1 }, context), /contour and process/);
  assert.throws(() => buildMotionInsertion('arc-ccw', { endX: 1, endY: 1 }, context), /center/);
  assert.throws(() => validateInsertionIndex(['G01 X1'], 2.5), /outside/);
  assert.doesNotThrow(() => validateInsertionIndex(['G01 X1'], 1));
});
