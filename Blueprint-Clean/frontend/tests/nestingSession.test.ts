import assert from 'node:assert/strict';
import { test } from 'node:test';

import { importControllerDocument } from '../utils/gcodeDocument.ts';
import {
  assertSourcesPreserved,
  cancelActivePart,
  confirmActivePart,
  cornerPoint,
  createNestSession,
  duplicateLastPart,
  exportCombinedNest,
  importActivePart,
  nestWarnings,
  positionedPoints,
  rapidConnections,
  translateActivePart,
} from '../utils/nestingSession.ts';

const encoder = new TextEncoder();
const part = (name: string, x = 2, y = 2) => ({ name, document: importControllerDocument(encoder.encode(`G21 G90\nG00 X0 Y0\nG01 X${x} Y0\nG01 X${x} Y${y}\nG01 X0 Y${y}\nG01 X0 Y0\nM30\n`)) });

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

test('combined export fails closed while imported source bytes remain preserved', () => {
  const first = part('Part 1');
  const session = importActivePart(createNestSession(20, 20, 'bottom-left'), first.document, first.name);
  assertSourcesPreserved(session);
  assert.throws(exportCombinedNest, /verified controller profile/);
});
