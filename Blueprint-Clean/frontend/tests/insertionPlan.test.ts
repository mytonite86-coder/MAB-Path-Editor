import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTextDocument, serializeTextDocument, interpretToolpath } from '../utils/gcodeDocument.ts';
import { inspectInsertion, planInsertion } from '../utils/insertionPlan.ts';

const header = 'G21 G90 G91.1 G17 G40 G49 G54 G80 G94 F120\r\nM5\r\nG00 X-10 Y5\r\n';
const tail = '(retained comment)\nG00 X20 Y30\r\nG01 X40 Y60\r\nM2';

test('source arcs must validate before subsequent insertion; valid arcs retain their endpoint', () => {
  const doc = parseTextDocument(header + 'G02 X2 Y7 I6 J1\n' + tail);
  assert.deepEqual(inspectInsertion(doc, 3).context.start, { x: 2, y: 7 });
  assert.throws(() => inspectInsertion(parseTextDocument(header + 'G02 X2 Y8 I6 J1\n' + tail), 3), /same nonzero/);
  assert.throws(() => inspectInsertion(parseTextDocument(header + 'G02 X2 Y7 I6\n' + tail), 3), /both I\/J/);
});

test('insertion preserves all original records, endings and BOM; original snapshot is undo', () => {
  const doc = parseTextDocument(header + tail, true);
  const before = serializeTextDocument(doc);
  const result = planInsertion(doc, 2, 'line', { endX: -5.123456, endY: -20 });
  assert.equal(serializeTextDocument(doc), before);
  assert.equal(result.document.hasUtf8Bom, true);
  assert.equal(serializeTextDocument(result.document), header + 'G01 X-5.123456 Y-20\r\n' + tail);
  const previous = interpretToolpath(doc.lines).slice(-2).map(p => [p.x, p.y, p.mode]);
  const next = interpretToolpath(result.document.lines).slice(-2).map(p => [p.x, p.y, p.mode]);
  assert.deepEqual(next, previous);
  assert.match(result.downstream, /rapid starts/);
});

test('unknown state, unsafe following blocks, process commands and numbered source are blocked', () => {
  for (const source of [header.replace('G17 ', '') + tail, header + 'G01 X0 Y0\nM2', header + 'X0 Y0\nM2', header.replace('M5', 'M3') + tail, header + 'N10 G00 X20 Y30', header + 'G00 X20 Y30*17', header.replace('G21', '(G21)') + tail, header + 'G00 X20\nM2']) {
    assert.throws(() => inspectInsertion(parseTextDocument(source), 2));
  }
});

test('before program end allowed, after end and executable trailing data blocked', () => {
  const doc = parseTextDocument(header + 'M30');
  assert.doesNotThrow(() => planInsertion(doc, 2, 'rapid', { endX: -20, endY: -30 }));
  assert.throws(() => inspectInsertion(doc, 3), /after program end/);
  assert.throws(() => inspectInsertion(parseTextDocument(header + 'M2\nG1 X10'), 2), /after program end/);
});

test('G91 insertion requires explicit G90 rapid rejoin and retains absolute path after it', () => {
  const doc = parseTextDocument(header + 'G91\nG90 G00 X20 Y30\nG1 X40 Y60\nM2');
  const result = planInsertion(doc, 3, 'line', { endX: -20, endY: 0 });
  assert.equal(result.generated, 'G01 X-10 Y-5');
  assert.deepEqual(interpretToolpath(result.document.lines).slice(-2).map(p => [p.x, p.y]), [[20, 30], [40, 60]]);
});
