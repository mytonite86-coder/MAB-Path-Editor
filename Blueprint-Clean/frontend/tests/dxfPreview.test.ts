import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { encodeTextDocument, importControllerDocument } from '../utils/gcodeDocument.ts';
import { fitPreview } from '../utils/previewGeometry.ts';

const fixturePath = resolve('../../../fixtures/Greenman (1) DXF.dxf');

test('Randy DXF resolves INSERT -> Block_0 -> SPLINE into visible preview geometry', () => {
  const source = new Uint8Array(readFileSync(fixturePath));
  const document = importControllerDocument(source);
  assert.equal(document.sourceKind, 'dxf');
  assert.deepEqual(document.resolvedBlocks, ['Block_0']);
  assert.equal(document.unsupportedEntities?.HATCH, 7);
  assert.ok((document.previewGeometry?.length ?? 0) > 44);
  assert.ok(document.previewGeometry?.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
  assert.equal(document.previewGeometry?.filter(point => point.breakBefore).length, 44);
  const fit = fitPreview(document.previewGeometry!, 320, 240);
  assert.ok(fit.maxX > fit.minX && fit.maxY > fit.minY, 'Randy geometry must occupy visible two-dimensional bounds');
  const visibleSegments = document.previewGeometry!.filter((point, index, points) => {
    if (index === 0 || point.breakBefore) return false;
    return Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 0;
  });
  assert.ok(visibleSegments.length > 0, 'the preview renderer must receive non-zero drawable segments');
  assert.deepEqual(encodeTextDocument(document), source, 'preview import must preserve Randy source bytes');
});
