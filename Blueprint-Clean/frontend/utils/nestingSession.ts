import { encodeTextDocument, interpretToolpath, type InterpretedPoint, type TextDocument } from './gcodeDocument.ts';

export type StartCorner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
export type NestPoint = InterpretedPoint & { x: number; y: number };
export type NestPart = {
  id: number;
  name: string;
  source: TextDocument;
  sourceBytes: Uint8Array;
  original: InterpretedPoint[];
  offsetX: number;
  offsetY: number;
};
export type NestSession = {
  plate: { width: number; length: number; corner: StartCorner; start: { x: number; y: number } };
  anchored: NestPart[];
  active?: NestPart;
  nextId: number;
};

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a finite positive number.`);
  return value;
}

export function cornerPoint(width: number, length: number, corner: StartCorner) {
  return {
    x: corner.endsWith('right') ? width : 0,
    y: corner.startsWith('top') ? length : 0,
  };
}

export function createNestSession(width: number, length: number, corner: StartCorner): NestSession {
  finitePositive(width, 'Plate width');
  finitePositive(length, 'Plate length');
  if (!['bottom-left', 'bottom-right', 'top-left', 'top-right'].includes(corner)) throw new Error('Select one of the four plate corners.');
  return { plate: { width, length, corner, start: cornerPoint(width, length, corner) }, anchored: [], nextId: 1 };
}

function supportedPart(source: TextDocument, name: string, session: NestSession): NestPart {
  if (source.sourceKind === 'dxf') throw new Error('DXF is preview-only and cannot be transformed or exported in S1.5 nesting.');
  const original = interpretToolpath(source.lines);
  if (original.length < 2 || original.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new Error('This program does not have finite supported toolpath geometry for nesting.');
  }
  const start = original[0];
  return {
    id: session.nextId,
    name,
    source,
    sourceBytes: encodeTextDocument(source),
    original,
    offsetX: session.plate.start.x - start.x,
    offsetY: session.plate.start.y - start.y,
  };
}

export function importActivePart(session: NestSession, source: TextDocument, name: string): NestSession {
  if (session.active) throw new Error('Confirm or cancel the current active part before importing another.');
  return { ...session, active: supportedPart(source, name, session), nextId: session.nextId + 1 };
}

export function duplicateLastPart(session: NestSession): NestSession {
  if (session.active) throw new Error('Confirm or cancel the current active part first.');
  const previous = session.anchored.at(-1);
  if (!previous) throw new Error('Confirm Part 1 before using Add Part.');
  return importActivePart(session, previous.source, `${previous.name} copy ${session.nextId}`);
}

export function translateActivePart(session: NestSession, deltaX: number, deltaY: number): NestSession {
  if (!session.active) throw new Error('Import a part before placing it.');
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error('Placement translation must be finite.');
  return { ...session, active: { ...session.active, offsetX: session.active.offsetX + deltaX, offsetY: session.active.offsetY + deltaY } };
}

export function confirmActivePart(session: NestSession): NestSession {
  if (!session.active) throw new Error('There is no active part to confirm.');
  return { ...session, anchored: [...session.anchored, session.active], active: undefined };
}

export function cancelActivePart(session: NestSession): NestSession {
  return session.active ? { ...session, active: undefined } : session;
}

export function positionedPoints(part: NestPart): NestPoint[] {
  return part.original.map(point => ({ ...point, x: point.x + part.offsetX, y: point.y + part.offsetY }));
}

export function rapidConnections(session: NestSession): { from: NestPoint; to: NestPoint }[] {
  const parts = [...session.anchored, ...(session.active ? [session.active] : [])];
  let previous: NestPoint = { ...session.plate.start };
  return parts.map(part => {
    const points = positionedPoints(part);
    const connection = { from: previous, to: points[0] };
    previous = points.at(-1)!;
    return connection;
  });
}

function segments(part: NestPart) {
  const points = positionedPoints(part);
  return points.slice(1).flatMap((point, index) => point.breakBefore ? [] : [[points[index], point] as const]);
}

function orientation(a: NestPoint, b: NestPoint, c: NestPoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function intersects(a: readonly [NestPoint, NestPoint], b: readonly [NestPoint, NestPoint]) {
  const [a1, a2] = a, [b1, b2] = b;
  const o1 = orientation(a1, a2, b1), o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1), o4 = orientation(b1, b2, a2);
  const epsilon = 1e-9;
  const onSegment = (start: NestPoint, end: NestPoint, point: NestPoint) =>
    Math.abs(orientation(start, end, point)) <= epsilon &&
    point.x >= Math.min(start.x, end.x) - epsilon && point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon && point.y <= Math.max(start.y, end.y) + epsilon;
  return (o1 * o2 < 0 && o3 * o4 < 0) ||
    onSegment(a1, a2, b1) || onSegment(a1, a2, b2) || onSegment(b1, b2, a1) || onSegment(b1, b2, a2);
}

export function nestWarnings(session: NestSession): string[] {
  const warnings: string[] = [];
  const parts = [...session.anchored, ...(session.active ? [session.active] : [])];
  for (const part of parts) {
    if (positionedPoints(part).some(point => point.x < 0 || point.x > session.plate.width || point.y < 0 || point.y > session.plate.length)) {
      warnings.push(`${part.name} extends outside the plate bounds.`);
    }
  }
  for (let left = 0; left < parts.length; left += 1) {
    for (let right = left + 1; right < parts.length; right += 1) {
      if (segments(parts[left]).some(a => segments(parts[right]).some(b => intersects(a, b)))) {
        warnings.push(`${parts[left].name} and ${parts[right].name} have intersecting drawable geometry.`);
      }
    }
  }
  return warnings;
}

export function assertSourcesPreserved(session: NestSession): void {
  for (const part of [...session.anchored, ...(session.active ? [session.active] : [])]) {
    const current = encodeTextDocument(part.source);
    if (current.length !== part.sourceBytes.length || current.some((byte, index) => byte !== part.sourceBytes[index])) {
      throw new Error(`${part.name} source changed during placement.`);
    }
  }
}

export function exportCombinedNest(): never {
  throw new Error('Combined export is unavailable until a verified controller profile defines %, M2, M30, numbering and checksum boundaries.');
}
