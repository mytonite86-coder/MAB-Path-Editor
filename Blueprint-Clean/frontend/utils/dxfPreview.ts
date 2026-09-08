import DxfParser from 'dxf-parser';

import type { InterpretedPoint } from './gcodeDocument';

type Point = { x: number; y: number; z?: number };
type Transform = { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
type DxfEntity = Record<string, unknown> & { type?: string; name?: string; position?: Point };
type DxfBlock = { entities?: DxfEntity[]; position?: Point };

export type DxfPreview = {
  points: InterpretedPoint[];
  unsupportedEntities: Record<string, number>;
  resolvedBlocks: string[];
};

const identity: Transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

function transformPoint(point: Point, transform: Transform): Point {
  const x = point.x * transform.scaleX;
  const y = point.y * transform.scaleY;
  const cosine = Math.cos(transform.rotation);
  const sine = Math.sin(transform.rotation);
  return { x: transform.x + x * cosine - y * sine, y: transform.y + x * sine + y * cosine };
}

function combine(parent: Transform, local: Transform): Transform {
  const origin = transformPoint({ x: local.x, y: local.y }, parent);
  return {
    x: origin.x,
    y: origin.y,
    scaleX: parent.scaleX * local.scaleX,
    scaleY: parent.scaleY * local.scaleY,
    rotation: parent.rotation + local.rotation,
  };
}

function splinePoint(entity: DxfEntity, parameter: number): Point | null {
  const controlPoints = entity.controlPoints as Point[] | undefined;
  const knots = entity.knotValues as number[] | undefined;
  const weights = entity.weights as number[] | undefined;
  const degree = Number(entity.degreeOfSplineCurve);
  if (!controlPoints?.length || !knots?.length || !Number.isInteger(degree) || degree < 1) return null;

  const basis = (index: number, order: number): number => {
    if (order === 0) {
      const finalKnot = knots[knots.length - degree - 1];
      return (knots[index] <= parameter && parameter < knots[index + 1]) ||
        (parameter === finalKnot && index === controlPoints.length - 1) ? 1 : 0;
    }
    const leftDenominator = knots[index + order] - knots[index];
    const rightDenominator = knots[index + order + 1] - knots[index + 1];
    const left = leftDenominator === 0 ? 0 : ((parameter - knots[index]) / leftDenominator) * basis(index, order - 1);
    const right = rightDenominator === 0 ? 0 : ((knots[index + order + 1] - parameter) / rightDenominator) * basis(index + 1, order - 1);
    return left + right;
  };

  let weightedX = 0;
  let weightedY = 0;
  let divisor = 0;
  for (let index = 0; index < controlPoints.length; index += 1) {
    const contribution = basis(index, degree) * (weights?.[index] ?? 1);
    weightedX += controlPoints[index].x * contribution;
    weightedY += controlPoints[index].y * contribution;
    divisor += contribution;
  }
  return divisor === 0 ? null : { x: weightedX / divisor, y: weightedY / divisor };
}

function sampleSpline(entity: DxfEntity, transform: Transform): InterpretedPoint[] {
  const controlPoints = entity.controlPoints as Point[] | undefined;
  const knots = entity.knotValues as number[] | undefined;
  const degree = Number(entity.degreeOfSplineCurve);
  if (!controlPoints?.length || !knots?.length || !Number.isInteger(degree)) return [];
  const start = knots[degree];
  const end = knots[knots.length - degree - 1];
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];

  const sampleCount = Math.min(512, Math.max(16, controlPoints.length * 8));
  const points: InterpretedPoint[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const source = splinePoint(entity, start + ((end - start) * index) / sampleCount);
    if (!source) continue;
    const point = transformPoint(source, transform);
    points.push({ x: point.x, y: point.y, role: 'cut', geometry: 'straight', breakBefore: points.length === 0, commandEnd: index === sampleCount });
  }
  return points;
}

function rawEntityCounts(source: string): Record<string, number> {
  const lines = source.split(/\r\n|\n|\r/);
  const counts: Record<string, number> = {};
  for (let index = 0; index + 1 < lines.length; index += 2) {
    if (lines[index].trim() !== '0') continue;
    const type = lines[index + 1].trim().toUpperCase();
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

export function isAsciiDxf(source: string): boolean {
  return /(?:^|[\r\n])\s*0\s*[\r\n]+\s*SECTION\s*(?:[\r\n]|$)/i.test(source) &&
    /(?:^|[\r\n])\s*2\s*[\r\n]+\s*(?:HEADER|ENTITIES|BLOCKS)\s*(?:[\r\n]|$)/i.test(source);
}

export function parseDxfPreview(source: string): DxfPreview {
  const drawing = new DxfParser().parseSync(source);
  if (!drawing) throw new Error('The ASCII DXF could not be parsed; the source is unchanged.');
  const blocks = drawing.blocks as unknown as Record<string, DxfBlock>;
  const points: InterpretedPoint[] = [];
  const resolvedBlocks = new Set<string>();

  const visit = (entities: DxfEntity[], transform: Transform, stack: string[]) => {
    for (const entity of entities) {
      const type = entity.type?.toUpperCase() ?? 'UNKNOWN';
      if (type === 'SPLINE') {
        points.push(...sampleSpline(entity, transform));
        continue;
      }
      if (type !== 'INSERT' || !entity.name) continue;
      if (stack.includes(entity.name)) throw new Error(`Circular DXF block reference: ${[...stack, entity.name].join(' -> ')}`);
      const block = blocks[entity.name];
      if (!block?.entities) continue;
      resolvedBlocks.add(entity.name);
      const position = entity.position ?? { x: 0, y: 0 };
      const base = block.position ?? { x: 0, y: 0 };
      visit(block.entities, combine(transform, {
        x: position.x - base.x,
        y: position.y - base.y,
        scaleX: Number(entity.xScale) || 1,
        scaleY: Number(entity.yScale) || 1,
        rotation: (Number(entity.rotation) || 0) * Math.PI / 180,
      }), [...stack, entity.name]);
    }
  };
  visit(drawing.entities as unknown as DxfEntity[], identity, []);

  const rawCounts = rawEntityCounts(source);
  const unsupportedEntities: Record<string, number> = {};
  if (rawCounts.HATCH) unsupportedEntities.HATCH = rawCounts.HATCH;
  if (points.length === 0) throw new Error('No supported DXF preview geometry was found; the source is unchanged.');
  return { points, unsupportedEntities, resolvedBlocks: [...resolvedBlocks] };
}
