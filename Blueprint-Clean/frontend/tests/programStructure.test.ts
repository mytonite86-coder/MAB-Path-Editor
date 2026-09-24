import assert from 'node:assert/strict';
import test from 'node:test';
import { interpretToolpath, parseProgramEvents, reconstructProgramStructure } from '../utils/gcodeDocument.ts';

const source = [
  '%',
  '(PART LABEL RETAINED)',
  'G21 G90 G91.1',
  'M86',
  'G00 X-2 Y3',
  'F120',
  'M14',
  'G02 X8 Y3 I5 J0',
  'M15',
  'M30',
];

test('ordered events retain source lines, comments, motion geometry and modal state', () => {
  const events = parseProgramEvents(source);
  assert.deepEqual(events.map(event => event.order), source.map((_, index) => index));
  assert.deepEqual(events.map(event => event.sourceLine), source.map((_, index) => index));
  assert.equal(events[1].rawSourceLine, '(PART LABEL RETAINED)');
  assert.deepEqual(events[1].comments, ['PART LABEL RETAINED']);
  assert.equal(events[4].geometry?.mode, 'G00');
  assert.deepEqual(events[4].geometry?.end, { x: -2, y: 3 });
  assert.equal(events[4].motionState.distanceMode, 'absolute');
  assert.equal(events[7].geometry?.i, 5);
  assert.equal(events[7].geometry?.j, 0);
});

test('M/process and feed records are preserved without inventing controller meaning', () => {
  const events = parseProgramEvents(source);
  assert.deepEqual(events[3].mCodes, [86]);
  assert.equal(events[3].type, 'process');
  assert.equal(events[5].type, 'feed');
  assert.equal(events[5].feed, 120);
  assert.deepEqual(events[6].mCodes, [14]);
  assert.deepEqual(events[8].mCodes, [15]);
  assert.equal(events[8].processState.activity, 'unknown');
});

test('part and contour ownership fail closed without a verified family profile', () => {
  const structure = reconstructProgramStructure(source);
  assert.equal(structure.status, 'unsupported');
  assert.match(structure.reason ?? '', /No verified controller-family/);
  assert.deepEqual(structure.parts, []);
  assert.deepEqual(structure.contours, []);
  assert.equal(structure.events[7].programPartId, undefined);
  assert.equal(structure.events[7].contourId, undefined);
});

test('existing preview remains source-event traceable', () => {
  const points = interpretToolpath(source);
  const arcPoints = points.filter(point => point.line === 7);
  assert.ok(arcPoints.length > 1);
  assert.ok(arcPoints.every(point => point.eventIndex === 7));
  assert.equal(arcPoints.at(-1)?.geometry, 'arc-cw');
});
