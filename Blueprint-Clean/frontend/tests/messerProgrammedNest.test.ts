import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  decodeTextDocument,
  encodeTextDocument,
  interpretStructuredToolpath,
  parseProgramEvents,
  reconstructProgramStructure,
} from '../utils/gcodeDocument.ts';
import { messerProgrammedNestProfile } from '../utils/messerProgrammedNest.ts';

const fixturePath = 'tests/fixtures/combined-nest.cnc.txt';

test('real Messer programmed nest reconstructs exactly three traceable parts', async () => {
  const bytes = new Uint8Array(await readFile(fixturePath));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '302c3048768030abed67f6620916de415a2bcb605fd20f06a65622c059a289d2');
  const document = decodeTextDocument(bytes);
  assert.deepEqual(encodeTextDocument(document), bytes);
  const events = parseProgramEvents(document.lines);
  assert.equal(events.length, document.lines.length);
  assert.ok(events.every((event, index) => event.order === index && event.sourceLine === index));
  assert.ok(events.some(event => event.rawSourceLine === '(Seq 1 - Bat Axe 2)'));
  assert.ok(events.some(event => event.gCodes.includes(70)));
  assert.ok(events.some(event => event.motionState.distanceMode === 'incremental'));
  assert.ok(events.some(event => event.feed === 190));
  assert.ok(events.some(event => event.gCodes.includes(41)));
  assert.ok(events.some(event => event.gCodes.includes(40)));

  const structure = reconstructProgramStructure(document.lines, messerProgrammedNestProfile);
  assert.equal(structure.status, 'verified');
  assert.equal(structure.parts.length, 3);
  assert.equal(structure.contours.length, 3);
  assert.ok(structure.parts.every(part => part.contours.length === 1 && part.contours[0].kind === 'unknown'));
  assert.ok(structure.parts.every(part => part.orderedEventOrders.filter(order => structure.events[order].geometry?.mode === 'G00').length === 2));

  const owned = structure.parts.map(part => new Set(part.orderedEventOrders));
  for (let left = 0; left < owned.length; left += 1) {
    for (let right = left + 1; right < owned.length; right += 1) {
      assert.deepEqual([...owned[left]].filter(order => owned[right].has(order)), []);
    }
  }

  for (const part of structure.parts) {
    const eventsForPart = part.orderedEventOrders.map(order => structure.events[order]);
    assert.ok(eventsForPart.some(event => event.geometry?.mode === 'G01'));
    assert.ok(eventsForPart.some(event => event.geometry?.mode === 'G02'));
    assert.ok(eventsForPart.some(event => event.geometry?.mode === 'G03'));
    assert.ok(eventsForPart.some(event => event.geometry?.i !== undefined && event.geometry?.j !== undefined));
    assert.deepEqual(eventsForPart.filter(event => event.mCodes.some(code => code === 21 || code === 20)).map(event => event.mCodes[0]), [21, 20]);
    assert.ok(eventsForPart.every(event => event.programPartId === part.id));
  }

  const preview = interpretStructuredToolpath(document.lines, structure);
  assert.ok(preview.some(point => point.programPartId === 'messer-part-1'));
  assert.ok(preview.some(point => point.programPartId === 'messer-part-2'));
  assert.ok(preview.some(point => point.programPartId === 'messer-part-3'));
  assert.ok(preview.filter(point => point.contourId).every(point => point.geometry !== 'straight' || point.role === 'cut'));

  const colocated = [...document.lines];
  for (const part of structure.parts) colocated[part.sourceLineSpans[0].start] = 'G00X0Y0';
  const colocatedStructure = reconstructProgramStructure(colocated, messerProgrammedNestProfile);
  assert.equal(colocatedStructure.status, 'verified');
  assert.equal(colocatedStructure.parts.length, 3);
});

test('Messer profile uses sequencing, not spatial proximity, and incompatible input fails closed', () => {
  const incompatible = ['%', 'G70', 'G91', 'M86', 'G00X0Y0', 'G01X1Y1', 'M30'];
  const result = reconstructProgramStructure(incompatible, messerProgrammedNestProfile);
  assert.equal(result.status, 'unsupported');
  assert.deepEqual(result.parts, []);
  assert.match(result.reason ?? '', /placement|sequence|family/i);

  const noProfile = reconstructProgramStructure(incompatible);
  assert.equal(noProfile.status, 'unsupported');
  assert.deepEqual(noProfile.parts, []);
});
