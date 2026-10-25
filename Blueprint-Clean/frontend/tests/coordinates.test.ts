import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coordinateDescription, interpretToolpath, patchSourceLine, readSourceLineValues } from '../utils/gcodeDocument.ts';
import { fitPreview, selectedMoveMeasurements } from '../utils/previewGeometry.ts';

test('all quadrants and large negative coordinates fit the actual viewport', () => {
  const points = [{ x: -500, y: -1000 }, { x: 80, y: 400 }, { x: 0, y: 0 }];
  for (const width of [200, 320, 1000]) {
    const transform = fitPreview(points, width, 240);
    for (const point of points) {
      const screen = transform.project(point);
      assert.ok(screen.x >= 19.99 && screen.x <= width - 19.99);
      assert.ok(screen.y >= 19.99 && screen.y <= 220.01);
    }
    assert.ok(transform.project({ x: 0, y: 10 }).y < transform.project({ x: 0, y: -10 }).y);
  }
});

test('degenerate and nonfinite bounds do not break fit; pan is display-only', () => {
  const points = [{ x: -5, y: -5 }, { x: Infinity, y: NaN }];
  const fit = fitPreview(points, 320, 240);
  assert.deepEqual(fit.project(points[0]), { x: 160, y: 120 });
  assert.deepEqual(fitPreview(points, 320, 240, 2, 10, -20).project(points[0]), { x: 170, y: 100 });
});

test('implicit negative moves show and edit their own literal source words', () => {
  const lines = ['G20 G90', 'G01 X-2 Y-3', 'X-8 Y-7 ; X99', 'X-10 Y-9'];
  assert.deepEqual(readSourceLineValues(lines[2]), { X: '-8', Y: '-7' });
  const updated = [...lines];
  updated[2] = patchSourceLine(lines[2], { X: '-9.25', Y: '+2' });
  assert.equal(updated[2], 'X-9.25 Y+2 ; X99');
  assert.equal(updated[1], lines[1]);
  assert.equal(updated[3], lines[3]);
});

test('compact motion and nested comments do not misdirect edits', () => {
  const line = '(X99 (Y77)) G1X-2Y-3 ; X88';
  assert.deepEqual(readSourceLineValues(line), { G: '1', X: '-2', Y: '-3' });
  assert.equal(patchSourceLine(line, { X: '-4' }), '(X99 (Y77)) G1X-4Y-3 ; X88');
  assert.deepEqual(readSourceLineValues('(G1 X2) ; Y8'), {});
});

test('unchanged motion field does not prevent endpoint editing on a multi-G line', () => {
  assert.equal(patchSourceLine('G20 G90 G1 X-2 Y-3', { G: '1', X: '-4', Y: '-3' }), 'G20 G90 G1 X-4 Y-3');
});

test('ambiguous, missing, nonfinite or non-motion word edits fail without mutation', () => {
  for (const [line, edits] of [
    ['X-2 X-3', { X: '1' }], ['Y-2', { X: '1' }], ['X-2', { X: 'Infinity' }],
    ['X-2', { X: '1e3' }], ['G20 X-2', { G: '1' }], ['G1 X-2', { G: '90' }],
  ] as const) assert.throws(() => patchSourceLine(line, edits));
});

test('measurements preserve signed start, end and delta in G90 and G91', () => {
  for (const lines of [
    ['G90', 'G0 X-2 Y-3', 'G1 X-8 Y-7'],
    ['G91', 'G0 X-2 Y-3', 'G1 X-6 Y-4'],
  ]) {
    const move = selectedMoveMeasurements(interpretToolpath(lines), 2)!;
    assert.equal(move.start.x, -2); assert.equal(move.start.y, -3);
    assert.equal(move.end.x, -8); assert.equal(move.end.y, -7);
    assert.equal(move.dx, -6); assert.equal(move.dy, -4);
    assert.equal(move.endpointDistance, Math.hypot(6, 4));
  }
});

test('measurement is scoped to the selected line, not preceding motion', () => {
  const points = interpretToolpath(['G0 X-2 Y-3', '(inspection comment)', 'G1 X-8 Y-7']);
  assert.equal(selectedMoveMeasurements(points, 1), null);
  assert.equal(selectedMoveMeasurements(points, 2)!.start.x, -2);
});

test('coordinate labels use executable units/modes and identify assumptions', () => {
  assert.equal(coordinateDescription(['(G20 G91)', 'G1 X-2'], 1), 'units undeclared; G90 assumed by preview');
  assert.equal(coordinateDescription(['G20 G90', 'G21 G91'], 0), 'inches (G20); absolute endpoints (G90)');
  assert.equal(coordinateDescription(['G20 G90', 'G21 G91'], 1), 'mm (G21); incremental endpoints (G91)');
});

test('negative arcs retain signed endpoints for both supported center modes', () => {
  for (const arc of ['G91.1 G02 X-4 Y-2 I-1 J0', 'G90.1 G02 X-4 Y-2 I-3 J-2']) {
    const points = interpretToolpath(['G90', 'G00 X-2 Y-2', arc]);
    const move = selectedMoveMeasurements(points, 2)!;
    assert.equal(move.start.x, -2);
    assert.ok(Math.abs(move.end.x + 4) < 1e-9);
    assert.ok(Math.abs(move.end.y + 2) < 1e-9);
    assert.ok(Math.abs(move.endpointDistance - 2) < 1e-9);
    assert.equal(move.mode, 'G02');
  }
});
