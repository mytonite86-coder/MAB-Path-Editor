import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  decodeTextDocument,
  detectContainer,
  encodeTextDocument,
  interpretToolpath,
  parseTextDocument,
  patchMotionBlock,
  readMotionBlockValues,
  serializeTextDocument,
} from '../utils/gcodeDocument.ts';

test('preserves mixed line endings, blank lines, comments, and terminal newline', () => {
  const source = 'G91\r\n\r\n  G01 X1.000 Y2 ; keep this\nM30\r';
  const document = parseTextDocument(source);
  assert.equal(serializeTextDocument(document), source);
});

test('preserves UTF-8 BOM bytes through a no-edit round trip', () => {
  const source = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('G0 X0\r\n')]);
  assert.deepEqual(encodeTextDocument(decodeTextDocument(source)), source);
});

test('patches only requested word values and preserves formatting and comments', () => {
  const lines = ['  G01   X1.000 Y-2.50 F30 ; X999 stays in comment', '(X88)', 'M08'];
  const patched = patchMotionBlock(lines, 0, { X: '7.25', Y: '-4' });
  assert.deepEqual(patched, ['  G01   X7.25 Y-4 F30 ; X999 stays in comment', '(X88)', 'M08']);
});

test('patches split controller blocks without restructuring untouched lines', () => {
  const lines = ['G02', 'X6.578', 'Y-0', 'I3.289', 'J1.197', 'M08', 'G01 X1 Y1'];
  const patched = patchMotionBlock(lines, 3, { I: '4.5', J: '-2' });
  assert.deepEqual(patched, ['G02', 'X6.578', 'Y-0', 'I4.5', 'J-2', 'M08', 'G01 X1 Y1']);
});

test('loads existing motion values for visible editing without reading comments', () => {
  const values = readMotionBlockValues(
    ['G02', 'X6.578', 'Y-0', 'I3.289', 'J1.197 ; X999', 'G01 X4 Y5'],
    3
  );
  assert.deepEqual(values, { G: '02', X: '6.578', Y: '-0', I: '3.289', J: '1.197' });
});

test('recognizes DWG signatures even when the extension says CNC', () => {
  assert.equal(detectContainer(new TextEncoder().encode('AC1032\0\0')), 'dwg');
  assert.equal(detectContainer(new TextEncoder().encode('G20\r\nG91\r\n')), 'text');
});

test('round-trips every supplied text CNC fixture byte for byte', (context) => {
  const fixtureRoot = path.resolve('test-fixtures/cnc-samples');
  if (!existsSync(fixtureRoot)) {
    context.skip('Owner-supplied local fixtures are not present.');
    return;
  }

  const candidates = readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(cnc|txt)$/i.test(entry.name))
    .map(entry => path.join(entry.parentPath, entry.name));
  const textPrograms = candidates.filter(file =>
    detectContainer(readFileSync(file)) === 'text'
  );

  assert.ok(textPrograms.length > 0, 'Expected at least one text controller fixture.');
  for (const file of textPrograms) {
    const source = readFileSync(file);
    const roundTrip = encodeTextDocument(decodeTextDocument(source));
    assert.equal(
      Buffer.compare(Buffer.from(roundTrip), source),
      0,
      path.relative(fixtureRoot, file)
    );
  }
});

test('interprets incremental and absolute positioning as separate modal states', () => {
  const points = interpretToolpath([
    'G91',
    'G00 X10 Y5',
    'G01 X2 Y-1',
    'G90',
    'G01 X3 Y4',
  ]).filter(point => point.commandEnd);

  assert.deepEqual(
    points.map(({ x, y }) => ({ x, y })),
    [{ x: 10, y: 5 }, { x: 12, y: 4 }, { x: 3, y: 4 }]
  );
});

test('reads compact inline moves and ignores coordinates inside comments', () => {
  const points = interpretToolpath([
    'G91',
    'G00X1.5Y-2.5 (X999 Y999)',
    'G01X2Y3 ; X888 Y888',
  ]).filter(point => point.commandEnd);

  assert.deepEqual(
    points.map(({ x, y }) => ({ x, y })),
    [{ x: 1.5, y: -2.5 }, { x: 3.5, y: 0.5 }]
  );
});

test('produces finite preview paths for every supplied text controller fixture', (context) => {
  const fixtureRoot = path.resolve('test-fixtures/cnc-samples');
  if (!existsSync(fixtureRoot)) {
    context.skip('Owner-supplied local fixtures are not present.');
    return;
  }

  const candidates = readdirSync(fixtureRoot, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(cnc|txt)$/i.test(entry.name))
    .map(entry => path.join(entry.parentPath, entry.name))
    .filter(file => detectContainer(readFileSync(file)) === 'text');

  for (const file of candidates) {
    const lines = decodeTextDocument(readFileSync(file)).lines;
    const points = interpretToolpath(lines);
    for (const point of points) {
      assert.ok(Number.isFinite(point.x), `${path.basename(file)} produced a non-finite X`);
      assert.ok(Number.isFinite(point.y), `${path.basename(file)} produced a non-finite Y`);
    }
  }
});
