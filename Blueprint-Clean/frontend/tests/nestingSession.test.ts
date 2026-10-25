import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { importControllerDocument, interpretToolpath, parseTextDocument, serializeTextDocument } from '../utils/gcodeDocument.ts';
import {
  assertSourcesPreserved,
  cancelActivePart,
  confirmActivePart,
  cornerPoint,
  createNestSession,
  duplicateLastPart,
  exportCombinedNest,
  exportReadiness,
  importActivePart,
  importNestProgram,
  inspectNestProgram,
  nestWarnings,
  positionedPoints,
  rapidConnections,
  translateActivePart,
} from '../utils/nestingSession.ts';

const encoder = new TextEncoder();
const part = (name: string, x = 2, y = 2) => ({ name, document: importControllerDocument(encoder.encode(`%\r\nG70\r\nG91\r\nM86\r\nG00X0Y0\r\nG01X${x}Y0\r\nG01X0Y${y}\r\nG01X-${x}Y0\r\nG01X0Y-${y}\r\nM30\r\n`)) });
const realFixtureDirectory = process.env.MAB_NEST_FIXTURE_DIR;
const realFixture = (name: string) => new Uint8Array(readFileSync(join(realFixtureDirectory!, name)));

test('four start corners establish the plate coordinate reference', () => {
  assert.deepEqual(cornerPoint(10, 20, 'bottom-left'), { x: 0, y: 0 });
  assert.deepEqual(cornerPoint(10, 20, 'bottom-right'), { x: 10, y: 0 });
  assert.deepEqual(cornerPoint(10, 20, 'top-left'), { x: 0, y: 20 });
  assert.deepEqual(cornerPoint(10, 20, 'top-right'), { x: 10, y: 20 });
});

test('Part 1 translates as one unit and confirmation anchors it', () => {
  const first = part('Part 1');
  let session = importActivePart(createNestSession(20, 20, 'bottom-left'), first.document, first.name);
  const before = positionedPoints(session.active!);
  session = translateActivePart(session, 5, 4);
  const after = positionedPoints(session.active!);
  assert.ok(after.every((point, index) => point.x - before[index].x === 5 && point.y - before[index].y === 4));
  session = confirmActivePart(session);
  assert.equal(session.anchored.length, 1);
  assert.equal(session.active, undefined);
});

test('Add Part duplicates current source without moving anchored parts', () => {
  const first = part('Widget');
  let session = confirmActivePart(translateActivePart(importActivePart(createNestSession(20, 20, 'bottom-left'), first.document, first.name), 2, 3));
  const anchored = positionedPoints(session.anchored[0]);
  session = translateActivePart(duplicateLastPart(session), 8, 8);
  assert.deepEqual(positionedPoints(session.anchored[0]), anchored);
  assert.deepEqual(session.active?.source.lines, first.document.lines);
  assertSourcesPreserved(session);
});

test('Add New Part creates a different active source and rapid chain is sequential', () => {
  const first = part('Part 1');
  const second = part('Part 2', 1, 1);
  let session = confirmActivePart(translateActivePart(importActivePart(createNestSession(30, 30, 'top-left'), first.document, first.name), 3, -8));
  session = translateActivePart(importActivePart(session, second.document, second.name), 10, -10);
  const rapids = rapidConnections(session);
  assert.equal(rapids.length, 2);
  assert.deepEqual(rapids[0].from, { x: 0, y: 30 });
  assert.deepEqual(rapids[1].from, positionedPoints(session.anchored[0]).at(-1));
  assert.deepEqual(rapids[1].to, positionedPoints(session.active!).at(0));
});

test('plate and reliable segment-intersection warnings are deterministic', () => {
  const first = part('Part 1', 4, 4);
  let session = confirmActivePart(importActivePart(createNestSession(5, 5, 'bottom-left'), first.document, first.name));
  session = translateActivePart(importActivePart(session, first.document, 'Part 2'), 3, 3);
  assert.ok(nestWarnings(session).some(warning => warning.includes('outside')));
  session = cancelActivePart(session);
  session = translateActivePart(importActivePart(session, first.document, 'Part 2'), 2, 0);
  assert.ok(nestWarnings(session).some(warning => warning.includes('intersecting')));
});

test('combined export stays gated until placements are confirmed while source bytes remain preserved', () => {
  const first = part('Part 1');
  const session = importActivePart(createNestSession(20, 20, 'bottom-left'), first.document, first.name);
  assertSourcesPreserved(session);
  assert.match(exportReadiness(session)!, /Confirm or cancel/);
  assert.throws(() => exportCombinedNest(session), /Confirm or cancel/);
});

test('first program establishes the verified family and incompatible programs fail closed', () => {
  let session = importActivePart(createNestSession(20, 20, 'bottom-left'), part('First').document, 'First');
  assert.equal(session.family?.id, 'messer-hypertherm-g70-g91-m86-m30-v1');
  session = confirmActivePart(session);
  const incompatible = importControllerDocument(encoder.encode('G21\nG90\nG00X0Y0\nG01X1Y1\nM30\n'));
  assert.throws(() => importActivePart(session, incompatible, 'Other'), /must match the CNC program family/);
});

test('verified duplicate export keeps one wrapper and one final terminator', () => {
  let session = confirmActivePart(importActivePart(createNestSession(40, 40, 'bottom-left'), part('Widget').document, 'Widget'));
  session = confirmActivePart(translateActivePart(duplicateLastPart(session), 8, 4));
  const output = serializeTextDocument(exportCombinedNest(session));
  assert.equal((output.match(/^%$/gm) ?? []).length, 1);
  assert.equal((output.match(/^M30$/gm) ?? []).length, 1);
  assert.equal((output.match(/^G70$/gm) ?? []).length, 1);
  assert.equal((output.match(/^M86$/gm) ?? []).length, 1);
  assert.equal((output.match(/^G00X/gm) ?? []).length, 4);
  assert.doesNotThrow(() => importControllerDocument(encoder.encode(output)));
  assertSourcesPreserved(session);
});

test('synthetic unsupported wrapper, modes, numbering and checksums remain rejected', () => {
  for (const source of [
    '%\nG20\nG91\nM86\nG00X1Y1\nM30\n',
    '%\nG70\nG90\nM86\nG00X1Y1\nM30\n',
    '%\nG70\nG91\nM86\nN10G00X1Y1\nM30\n',
    '%\nG70\nG91\nM86\nG00X1Y1*42\nM30\n',
    '%\nG70\nG91\nM86\nG00X1Y1\nM30\n%\n',
  ]) assert.throws(() => inspectNestProgram(parseTextDocument(source)), /must match the CNC program family/);
});

test('real Axe CNC family composes two and three programs, rejects NIF, re-imports, and preserves sources', { skip: !realFixtureDirectory }, () => {
  const names = ['Bat,Celtic, Axe01.cnc', 'Bat,Celtic, Axe02.cnc', 'Bat,Celtic, Axe03.cnc'];
  const bytes = names.map(realFixture);
  const documents = bytes.map(importNestProgram);
  const profiles = documents.map(inspectNestProgram);
  assert.ok(profiles.every(profile => profile.signature === profiles[0].signature));
  assert.throws(() => importNestProgram(realFixture('Bat,Celtic, Axe.nif')), /must match the CNC program family/);

  for (const count of [2, 3]) {
    let session = createNestSession(200, 200, 'bottom-left');
    for (let index = 0; index < count; index += 1) {
      session = importActivePart(session, documents[index], names[index]);
      if (index) session = translateActivePart(session, index * 25, index * 20);
      session = confirmActivePart(session);
    }
    const before = bytes.slice(0, count).map(value => Buffer.from(value).toString('hex'));
    const outputDocument = exportCombinedNest(session);
    const output = serializeTextDocument(outputDocument);
    const reimported = importControllerDocument(new TextEncoder().encode(output));
    assert.equal((output.match(/^%\r?$/gm) ?? []).length, 1);
    assert.equal((output.match(/^M30\r?$/gm) ?? []).length, 1);
    assert.equal((output.match(/^G70\r?$/gm) ?? []).length, 1);
    assert.equal((output.match(/^G91\r?$/gm) ?? []).length, 1);
    assert.equal((output.match(/^M86\r?$/gm) ?? []).length, 1);
    assert.equal((output.match(/^G00X[-\d.]+Y[-\d.]+\r?$/gm) ?? []).length, count + documents.slice(0, count).reduce((total, document) => total + document.lines.filter(line => /^G00X/i.test(line)).length, 0));
    for (let index = 0; index < count; index += 1) {
      const profile = profiles[index];
      const body = documents[index].lines.slice(profile.headerEnd, profile.terminator).join('\r\n');
      assert.ok(output.includes(body));
    }
    const reimportedPoints = interpretToolpath(reimported.lines);
    const intendedPoints = session.anchored.flatMap(positionedPoints);
    const bounds = (points: { x: number; y: number }[]) => ({
      minX: Math.min(...points.map(point => point.x)), maxX: Math.max(...points.map(point => point.x)),
      minY: Math.min(...points.map(point => point.y)), maxY: Math.max(...points.map(point => point.y)),
    });
    const actualBounds = bounds(reimportedPoints);
    const expectedBounds = bounds(intendedPoints);
    for (const key of ['minX', 'maxX', 'minY', 'maxY'] as const) assert.ok(Math.abs(actualBounds[key] - expectedBounds[key]) < 0.00001);
    const actualEnd = reimportedPoints.at(-1)!;
    const expectedEnd = positionedPoints(session.anchored.at(-1)!).at(-1)!;
    assert.ok(Math.abs(actualEnd.x - expectedEnd.x) < 0.00001 && Math.abs(actualEnd.y - expectedEnd.y) < 0.00001);
    assert.ok(reimportedPoints.length > documents.slice(0, count).reduce((total, document) => total + interpretToolpath(document.lines).length, 0));
    assertSourcesPreserved(session);
    assert.deepEqual(bytes.slice(0, count).map(value => Buffer.from(value).toString('hex')), before);
  }
});
