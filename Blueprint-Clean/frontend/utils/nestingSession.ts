import { encodeTextDocument, importControllerDocument, interpretToolpath, parseTextDocument, type InterpretedPoint, type TextDocument } from './gcodeDocument.ts';

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
export type NestProgramFamily = {
  id: 'messer-hypertherm-g70-g91-m86-m30-v1';
  signature: string;
  headerEnd: number;
  terminator: number;
};
export type NestSession = {
  plate: { width: number; length: number; corner: StartCorner; start: { x: number; y: number } };
  anchored: NestPart[];
  active?: NestPart;
  nextId: number;
  family?: NestProgramFamily;
};

const FAMILY_ERROR = 'Unsupported program format for this nest. Added parts must match the CNC program family established by Part 1.';
const ALLOWED_G = new Set([0, 1, 2, 3, 4, 40, 41, 70, 91]);
const ALLOWED_M = new Set([14, 15, 20, 21, 30, 86, 620, 621]);

function executable(line: string): string {
  let depth = 0;
  let tail = false;
  return [...line].map(character => {
    if (character === ';' && depth === 0) tail = true;
    if (tail) return ' ';
    if (character === '(') { depth += 1; return ' '; }
    if (character === ')' && depth > 0) { depth -= 1; return ' '; }
    return depth > 0 ? ' ' : character;
  }).join('').trim();
}

export function inspectNestProgram(source: TextDocument): NestProgramFamily {
  if (source.sourceKind === 'dxf' || source.hasUtf8Bom) throw new Error(FAMILY_ERROR);
  const nonblank = source.lines.map((line, index) => ({ line: line.trim(), index })).filter(record => record.line !== '');
  if (nonblank.length < 6 || nonblank[0].line !== '%' || nonblank[1].line.toUpperCase() !== 'G70' ||
      nonblank[2].line.toUpperCase() !== 'G91' || nonblank[3].line.toUpperCase() !== 'M86' ||
      nonblank.at(-1)!.line.toUpperCase() !== 'M30') throw new Error(FAMILY_ERROR);
  if (nonblank.filter(record => record.line === '%').length !== 1) throw new Error(FAMILY_ERROR);

  let motion = 0;
  for (const { line, index } of nonblank) {
    const code = executable(line);
    if (!code) continue;
    if (code === '%') continue;
    if (/^N\d+/i.test(code) || code.includes('*') || !/^(?:[A-Z]\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)\s*)+$/i.test(code)) throw new Error(FAMILY_ERROR);
    for (const match of code.matchAll(/([GM])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi)) {
      const value = Number(match[2]);
      if (match[1].toUpperCase() === 'G' && !ALLOWED_G.has(value)) throw new Error(FAMILY_ERROR);
      if (match[1].toUpperCase() === 'M' && !ALLOWED_M.has(value)) throw new Error(FAMILY_ERROR);
      if (match[1].toUpperCase() === 'M' && value === 30 && index !== nonblank.at(-1)!.index) throw new Error(FAMILY_ERROR);
      if (match[1].toUpperCase() === 'G' && [0, 1, 2, 3].includes(value)) motion += 1;
    }
  }
  if (motion === 0 || !/^G0?0(?:\s*[XY])/i.test(executable(nonblank[4].line))) throw new Error(FAMILY_ERROR);
  return {
    id: 'messer-hypertherm-g70-g91-m86-m30-v1',
    signature: 'text|%|G70|G91|implicit-G91.1|M86|unnumbered|no-checksum|M30',
    headerEnd: nonblank[3].index + 1,
    terminator: nonblank.at(-1)!.index,
  };
}

export function importNestProgram(bytes: Uint8Array): TextDocument {
  try { return importControllerDocument(bytes); }
  catch { throw new Error(FAMILY_ERROR); }
}

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
  const family = inspectNestProgram(source);
  if (session.family && session.family.signature !== family.signature) throw new Error(FAMILY_ERROR);
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
  const family = inspectNestProgram(source);
  return { ...session, family: session.family ?? family, active: supportedPart(source, name, session), nextId: session.nextId + 1 };
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

function coordinate(value: number): string {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

export function exportReadiness(session: NestSession): string | null {
  if (session.active) return 'Confirm or cancel the active placement before export.';
  if (session.anchored.length === 0) return 'Confirm at least one compatible part before export.';
  if (!session.family) return FAMILY_ERROR;
  try {
    assertSourcesPreserved(session);
    for (const part of session.anchored) {
      if (inspectNestProgram(part.source).signature !== session.family.signature) return FAMILY_ERROR;
    }
  } catch (error) { return error instanceof Error ? error.message : FAMILY_ERROR; }
  return null;
}

export function exportCombinedNest(session: NestSession): TextDocument {
  const blocked = exportReadiness(session);
  if (blocked) throw new Error(blocked);
  const first = session.anchored[0];
  const firstProfile = inspectNestProgram(first.source);
  const output = first.source.lines.slice(0, firstProfile.headerEnd);
  let current = session.plate.start;

  for (const part of session.anchored) {
    const profile = inspectNestProgram(part.source);
    output.push(`G00X${coordinate(part.offsetX - current.x)}Y${coordinate(part.offsetY - current.y)}`);
    output.push(...part.source.lines.slice(profile.headerEnd, profile.terminator));
    const end = positionedPoints(part).at(-1)!;
    current = { x: end.x, y: end.y };
  }
  output.push('M30');
  return parseTextDocument(output.join('\r\n') + '\r\n');
}
