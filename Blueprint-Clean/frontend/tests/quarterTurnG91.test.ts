import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  encodeTextDocument, importControllerDocument, parseTextDocument, serializeTextDocument,
} from '../utils/gcodeDocument.ts';
import { rotateG91PartVectors } from '../utils/quarterTurnG91.ts';

const load = (name: string) => readFileSync(join('tests', 'fixtures', name), 'utf8');
const original = load('rotation-g91-original.nc');
const expected = load('rotation-g91-expected-90ccw.nc');
const source = parseTextDocument(original);
const reference = parseTextDocument(expected);
const partALines = [10, 11, 12, 13, 14] as const;
const partBLines = [16, 17, 18, 19] as const;

const g91Moves = (lines: string[]) => lines.filter(line => /^G0[123]\s/i.test(line));
function vectors(lines: string[]) {
  return lines.map(line => {
    const word = (letter: string) => Number(line.match(new RegExp(`${letter}\\s*([+-]?\\d+(?:\\.\\d*)?)`, 'i'))?.[1] ?? '0');
    return { x: word('X'), y: word('Y'), i: word('I'), j: word('J') };
  });
}
function bounds(points: { x: number; y: number }[]) {
  return {
    width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
    height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)),
  };
}
function pathEndpoints(moves: { x: number; y: number }[]) {
  let x = 0, y = 0;
  return [{ x, y }, ...moves.map(p => ({ x: (x += p.x), y: (y += p.y) }))];
}
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);

test('Strider golden G91 program: only Part A XY/IJ vectors turn 90 CCW', () => {
  const rotated = rotateG91PartVectors(source, partALines, 'ccw');
  assert.deepEqual(g91Moves(rotated.lines), g91Moves(reference.lines));
  assert.deepEqual(partBLines.map(i => rotated.lines[i]), partBLines.map(i => source.lines[i]));
  assert.equal(rotated.lines[14], 'G02 X0.000 Y2.000 I0.000 J1.000');
  assert.equal(rotated.lines[14].slice(0, 3), source.lines[14].slice(0, 3));
  assert.equal(rotated.lines.length, source.lines.length);
  for (let i = 0; i < source.lines.length; i++) {
    if (!partALines.includes(i as typeof partALines[number])) {
      assert.equal(rotated.lines[i], source.lines[i], `Unselected line ${i} changed`);
    }
  }
  assert.equal(serializeTextDocument(source), original, 'Original must not be changed');
});

test('segment length, radius and bounding dimensions are invariant under a 90-degree turn', () => {
  const rotated = rotateG91PartVectors(source, partALines, 'ccw');
  const before = vectors(partALines.map(i => source.lines[i]));
  const after = vectors(partALines.map(i => rotated.lines[i]));
  for (let i = 0; i < before.length; i++) {
    near(Math.hypot(before[i].x, before[i].y), Math.hypot(after[i].x, after[i].y));
  }
  assert.deepEqual(before.slice(0, 4).map(v => Math.hypot(v.x, v.y)), [2, 1, 2, 1]);
  assert.deepEqual(after.slice(0, 4).map(v => Math.hypot(v.x, v.y)), [2, 1, 2, 1]);
  near(Math.hypot(before[4].i, before[4].j), 1);
  near(Math.hypot(after[4].i, after[4].j), 1);
  const rectangleBefore = bounds(pathEndpoints(before.slice(0, 4)));
  const rectangleAfter = bounds(pathEndpoints(after.slice(0, 4)));
  assert.deepEqual(rectangleBefore, { width: 2, height: 1 });
  assert.deepEqual(rectangleAfter, { width: 1, height: 2 });
});

test('rotated export can be re-imported and remains rotated at the G-code level', () => {
  const rotated = rotateG91PartVectors(source, partALines, 'ccw');
  const reimported = importControllerDocument(encodeTextDocument(rotated));
  assert.deepEqual(g91Moves(reimported.lines), g91Moves(reference.lines));
  assert.equal(reimported.lines[10], 'G01 X0.000 Y2.000');
  assert.notEqual(reimported.lines[10], source.lines[10]);
});

test('four CCW turns and four CW turns return to original source exactly', () => {
  for (const direction of ['ccw', 'cw'] as const) {
    let transformed = source;
    for (let i = 0; i < 4; i++) {
      transformed = rotateG91PartVectors(transformed, partALines, direction);
    }
    assert.equal(serializeTextDocument(transformed), original);
    assert.deepEqual(partBLines.map(i => transformed.lines[i]), partBLines.map(i => source.lines[i]));
  }
});

test('other machine words and the source document are unchanged; single-axis turns are reversible', () => {
  const input = parseTextDocument('G70\nG91\nG01 X1.000 Z2.5 F15 ; keep this\nG02 Y-2.000 I1.000 M20\n');
  const rotated = rotateG91PartVectors(input, [2, 3], 'ccw');
  assert.equal(rotated.lines[2], 'G01 Y1.000 Z2.5 F15 ; keep this');
  assert.equal(rotated.lines[3], 'G02 X2.000 J1.000 M20');
  let roundTrip = input;
  for (let i = 0; i < 4; i++) roundTrip = rotateG91PartVectors(roundTrip, [2, 3], 'ccw');
  assert.equal(serializeTextDocument(roundTrip), serializeTextDocument(input));
});

test('unsupported absolute coordinates and duplicate words fail closed', () => {
  assert.throws(
    () => rotateG91PartVectors(parseTextDocument('G90\nG01X1Y2\n'), [1], 'ccw'),
    /requires G91/,
  );
  assert.throws(
    () => rotateG91PartVectors(parseTextDocument('G91\nG90.1\nG02 X1Y0 I1J0\n'), [2], 'ccw'),
    /incremental I\/J/,
  );
  assert.throws(
    () => rotateG91PartVectors(parseTextDocument('G91\nG01X1X2Y1\n'), [1], 'ccw'),
    /Repeated coordinate/,
  );
  assert.throws(() => rotateG91PartVectors(source, [], 'ccw'), /Select a labelled part/);
  assert.throws(() => rotateG91PartVectors(source, [1000], 'cw'), /invalid source-line/);
});
