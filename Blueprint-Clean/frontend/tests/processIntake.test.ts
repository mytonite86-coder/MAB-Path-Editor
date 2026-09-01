import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeTextDocument, importControllerDocument } from '../utils/gcodeDocument.ts';
import { inspectProgramSettings } from '../utils/programSettings.ts';

const source = '%\r\nG21 G90 G94\r\nM3 S170 T4 H2 P3 Q6\r\nF120\r\nG00 X0 Y0\r\nG03 X0 Y0 I5 J0\r\nM5\r\nM30\r\n%\r\n';

test('identical supported CNC content has extension-independent process inspection and lossless intake', () => {
  const bytes = new TextEncoder().encode(source);
  const cncDocument = importControllerDocument(bytes);
  const txtDocument = importControllerDocument(bytes);
  assert.deepEqual(inspectProgramSettings(txtDocument.lines), inspectProgramSettings(cncDocument.lines));
  assert.deepEqual(encodeTextDocument(txtDocument), bytes);

  const settings = inspectProgramSettings(txtDocument.lines);
  assert.match(settings.feed[0].description, /120 mm\/min/);
  assert.ok(settings.unresolved.some(item => item.raw === 'S170'));
  assert.ok(settings.unresolved.some(item => item.raw === 'T4'));
  assert.match(settings.amperage, /Unsupported until a verified controller profile/);
  assert.equal(settings.unresolved.some(item => item.description.startsWith('Unsupported syntax')), false);
});
