import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';

import { encodeTextDocument, importControllerDocument } from '../utils/gcodeDocument.ts';
import { fitPreview } from '../utils/previewGeometry.ts';

const fixturePath = resolve('../../../fixtures/Greenman (1) DXF.dxf');

const portableInsertSplineDxf = `0
SECTION
2
BLOCKS
0
BLOCK
2
Block_0
10
0
20
0
0
SPLINE
70
8
71
2
72
6
73
3
74
0
40
0
40
0
40
0
40
1
40
1
40
1
10
0
20
0
10
1
20
1
10
2
20
0
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
INSERT
2
Block_0
10
5
20
-3
0
ENDSEC
0
EOF
`;

test('portable INSERT -> block -> SPLINE regression produces translated preview geometry', () => {
  const document = importControllerDocument(new TextEncoder().encode(portableInsertSplineDxf));
  assert.equal(document.sourceKind, 'dxf');
  assert.deepEqual(document.resolvedBlocks, ['Block_0']);
  assert.ok((document.previewGeometry?.length ?? 0) > 2);
  assert.ok(document.previewGeometry?.every(point => point.x >= 5 && point.y >= -3));
});

test('Randy DXF resolves INSERT -> Block_0 -> SPLINE into visible preview geometry', { skip: !existsSync(fixturePath) }, () => {
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
