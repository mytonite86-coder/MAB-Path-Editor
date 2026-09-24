import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  decodeTextDocument,
  encodeTextDocument,
  interpretStructuredToolpath,
  reconstructProgramStructure,
} from '../utils/gcodeDocument.ts';
import { messerProgrammedNestProfile } from '../utils/messerProgrammedNest.ts';
import { reviewMeasurementEdit } from '../utils/measurementEdit.ts';
import { rotateVerifiedProgramPart, verifiedPartPivot } from '../utils/programPartRotation.ts';

const fixturePath = 'tests/fixtures/combined-nest.cnc.txt';
const close = (actual: number, expected: number, tolerance = 2e-5) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

async function fixture() {
  const document = decodeTextDocument(new Uint8Array(await readFile(fixturePath)));
  const structure = reconstructProgramStructure(document.lines, messerProgrammedNestProfile);
  assert.equal(structure.status, 'verified');
  return { document, structure };
}

function cutPoints(lines: string[], structure: ReturnType<typeof reconstructProgramStructure>, partId: string) {
  return interpretStructuredToolpath(lines, structure)
    .filter(point => point.programPartId === partId && point.contourId)
    .map(point => ({ x: point.x, y: point.y }));
}

test('rotates real Part 1 geometry and I/J while preserving structure and neighboring cut geometry', async () => {
  const { document, structure } = await fixture();
  const beforePivot = verifiedPartPivot(document.lines, structure, 'messer-part-1');
  const beforePart1 = cutPoints(document.lines, structure, 'messer-part-1');
  const beforePart2 = cutPoints(document.lines, structure, 'messer-part-2');
  const beforePart3 = cutPoints(document.lines, structure, 'messer-part-3');
  const part2 = structure.parts[1];
  const part2LinesBefore = part2.orderedEventOrders.map(order => document.lines[structure.events[order].sourceLine]);

  const rotated = rotateVerifiedProgramPart(document, structure, 'messer-part-1', 1);
  const reparsed = reconstructProgramStructure(rotated.lines, messerProgrammedNestProfile);
  assert.equal(reparsed.status, 'verified');
  assert.equal(reparsed.parts.length, 3);
  const afterPivot = verifiedPartPivot(rotated.lines, reparsed, 'messer-part-1');
  close(afterPivot.x, beforePivot.x, 3e-5);
  close(afterPivot.y, beforePivot.y, 3e-5);

  const afterPart1 = cutPoints(rotated.lines, reparsed, 'messer-part-1');
  const radians = Math.PI / 180;
  afterPart1.forEach((point, index) => {
    const source = beforePart1[index];
    const expected = {
      x: beforePivot.x + (source.x - beforePivot.x) * Math.cos(radians) - (source.y - beforePivot.y) * Math.sin(radians),
      y: beforePivot.y + (source.x - beforePivot.x) * Math.sin(radians) + (source.y - beforePivot.y) * Math.cos(radians),
    };
    close(point.x, expected.x, 3e-5);
    close(point.y, expected.y, 3e-5);
  });
  for (const [id, before] of [['messer-part-2', beforePart2], ['messer-part-3', beforePart3]] as const) {
    const after = cutPoints(rotated.lines, reparsed, id);
    assert.equal(after.length, before.length);
    after.forEach((point, index) => { close(point.x, before[index].x); close(point.y, before[index].y); });
  }

  const part2LinesAfter = reparsed.parts[1].orderedEventOrders.map(order => rotated.lines[reparsed.events[order].sourceLine]);
  assert.notEqual(part2LinesAfter[0], part2LinesBefore[0]);
  assert.deepEqual(part2LinesAfter.slice(1), part2LinesBefore.slice(1));

  const beforeArc = structure.events.find(event => event.programPartId === 'messer-part-1' && event.geometry?.mode === 'G02')!;
  const afterArc = reparsed.events[beforeArc.order];
  assert.equal(afterArc.geometry?.mode, 'G02');
  assert.notEqual(afterArc.geometry?.i, beforeArc.geometry?.i);
  assert.notEqual(afterArc.geometry?.j, beforeArc.geometry?.j);
  assert.equal(afterArc.sourceLine, beforeArc.sourceLine);
  assert.equal(afterArc.programPartId, 'messer-part-1');
  assert.deepEqual(afterArc.mCodes, beforeArc.mCodes);

  const roundTrip = decodeTextDocument(encodeTextDocument(rotated));
  assert.equal(reconstructProgramStructure(roundTrip.lines, messerProgrammedNestProfile).parts.length, 3);
});

test('CW/CCW and repeated rotations are reversible within source precision and snapshots provide real Undo', async () => {
  const { document, structure } = await fixture();
  const plusOne = rotateVerifiedProgramPart(document, structure, 'messer-part-1', 1);
  const plusStructure = reconstructProgramStructure(plusOne.lines, messerProgrammedNestProfile);
  const backOne = rotateVerifiedProgramPart(plusOne, plusStructure, 'messer-part-1', -1);
  const backStructure = reconstructProgramStructure(backOne.lines, messerProgrammedNestProfile);
  const originalPoints = cutPoints(document.lines, structure, 'messer-part-1');
  const restoredPoints = cutPoints(backOne.lines, backStructure, 'messer-part-1');
  restoredPoints.forEach((point, index) => { close(point.x, originalPoints[index].x, 3e-4); close(point.y, originalPoints[index].y, 3e-4); });

  let held = document;
  let heldStructure = structure;
  const undoSnapshot = document;
  for (let index = 0; index < 12; index += 1) {
    held = rotateVerifiedProgramPart(held, heldStructure, 'messer-part-1', 1);
    heldStructure = reconstructProgramStructure(held.lines, messerProgrammedNestProfile);
  }
  assert.notDeepEqual(held.lines, undoSnapshot.lines);
  assert.deepEqual(undoSnapshot.lines, document.lines);
});

test('LINE editing remains available after rotation and unsupported programs stay fail closed', async () => {
  const { document, structure } = await fixture();
  const rotated = rotateVerifiedProgramPart(document, structure, 'messer-part-1', 1);
  const rotatedStructure = reconstructProgramStructure(rotated.lines, messerProgrammedNestProfile);
  const line = rotatedStructure.events.find(event => event.programPartId === 'messer-part-1' && event.geometry?.mode === 'G01')!.sourceLine;
  const currentX = rotatedStructure.events[line].geometry?.x;
  const review = reviewMeasurementEdit(rotated.lines, line, { X: String((currentX ?? 0) + 0.001) });
  assert.notEqual(review.source, rotated.lines[line]);

  const unknown = reconstructProgramStructure(['%', 'G90', 'G01X1Y1', 'M30']);
  assert.throws(() => rotateVerifiedProgramPart({ lines: ['%', 'G90', 'G01X1Y1', 'M30'], endings: ['', '', '', ''], hasUtf8Bom: false }, unknown, 'part-1', 1), /unsupported|verified/i);
});
