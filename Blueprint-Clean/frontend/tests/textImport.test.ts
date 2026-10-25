import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  encodeTextDocument,
  importControllerDocument,
  interpretToolpath,
  patchMotionBlock,
  serializeTextDocument,
} from '../utils/gcodeDocument.ts';

const encoder = new TextEncoder();
// Synthetic only: inches, absolute endpoints and negative Y; no vendor commands.
const lines = ['(synthetic fixture)', 'G20 G90', 'G00 X0 Y0', '', '  G01 X2.000 Y-3.500 F30 ; keep', 'M30'];

for (const filename of ['synthetic.txt', 'synthetic.TXT']) {
  for (const ending of ['\r\n', '\n', '\r']) {
    for (const bom of [false, true]) {
      test(`${filename}: byte-preserving import, edit, export, re-import (${JSON.stringify(ending)}, BOM=${bom})`, () => {
        const body = encoder.encode(lines.join(ending) + ending);
        const source = bom ? new Uint8Array([239, 187, 191, ...body]) : body;
        const original = importControllerDocument(source);
        assert.deepEqual(encodeTextDocument(original), source);
        const edited = { ...original, lines: patchMotionBlock(original.lines, 4, { Y: '-4.25' }) };
        assert.equal(serializeTextDocument(edited), lines.join(ending).replace('Y-3.500', 'Y-4.25') + ending);
        const exported = encodeTextDocument(edited);
        assert.deepEqual(encodeTextDocument(importControllerDocument(exported)), exported);
        assert.deepEqual(encodeTextDocument(original), source, 'undo snapshot remains byte-identical');
        assert.deepEqual(interpretToolpath(edited.lines).filter(point => point.commandEnd).map(({ x, y }) => [x, y]), [[0, 0], [2, -4.25]]);
        // Filename belongs to the UI, not the decoder. Neither extension is transformed here.
      });
    }
  }
}

test('preserves mixed endings and absence of terminal newline', () => {
  const source = encoder.encode('G20\r\nG90\nG01X2Y-3\rM30');
  assert.deepEqual(encodeTextDocument(importControllerDocument(source)), source);
});

test('preserves split controller words and opaque records without claiming their semantics', () => {
  const source = encoder.encode('%\r\nG20\r\nG90\r\nG01\r\nX2\r\nY-3\r\nVENDOR_UNKNOWN\r\nM30\r\n%');
  assert.deepEqual(encodeTextDocument(importControllerDocument(source)), source);
});

test('rejects empty, prose, configuration and comment-only motion claims', () => {
  for (const text of ['', ' \r\n', 'Please run G01 X2 Y3 tomorrow', 'mode=G01\nx=2\ny=3', '(G01 X2 Y3)', '; G01 X2 Y3', 'G20 G90\nM30']) {
    assert.throws(() => importControllerDocument(encoder.encode(text)), /empty|No supported/);
  }
});

test('misleading txt content cannot bypass DWG or binary detection', () => {
  assert.throws(() => importControllerDocument(encoder.encode('AC1032\0')), /DWG/);
  assert.throws(() => importControllerDocument(new Uint8Array([71, 0, 48, 0])), /Binary/);
  const lateBinary = encoder.encode('G01 X2 Y-3\n' + ' '.repeat(9000) + '\0');
  assert.throws(() => importControllerDocument(lateBinary), /Binary/);
  assert.throws(() => importControllerDocument(encoder.encode('G01 X2 Y-3\x01')), /Binary/);
});

test('rejects UTF-16 and invalid UTF-8 rather than converting or dropping bytes', () => {
  for (const source of [new Uint8Array([255, 254, 71, 0]), new Uint8Array([254, 255, 0, 71]), new Uint8Array([...encoder.encode('G01 X2 Y-3 ; '), 255])]) {
    const snapshot = source.slice();
    assert.throws(() => importControllerDocument(source), /encoding/);
    assert.deepEqual(source, snapshot);
  }
});
