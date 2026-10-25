export type InsertionKind = 'line' | 'arc-cw' | 'arc-ccw' | 'rapid' | 'pierce' | 'lead-in' | 'lead-out';

export type InsertionContext = {
  units: 'mm' | 'inch';
  distance: 'absolute' | 'incremental';
  arcCenter: 'absolute' | 'incremental';
  plane: 'XY';
  start: { x: number; y: number };
};

export type InsertionValues = {
  endX: number;
  endY: number;
  centerX?: number;
  centerY?: number;
};

export type InsertionResult = { lines: string[]; warning?: string };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Build a controller-neutral candidate without changing a document or enabling the UI. */
export function buildMotionInsertion(
  kind: InsertionKind,
  values: InsertionValues,
  context: InsertionContext,
  ending = '\n',
): InsertionResult {
  if (context.plane !== 'XY') throw new Error('Only the XY plane is supported by the S1 editor.');
  if (!['mm', 'inch'].includes(context.units) || !['absolute', 'incremental'].includes(context.distance) || !['absolute', 'incremental'].includes(context.arcCenter)) throw new Error('Explicit supported units and coordinate modes are required.');
  if (kind === 'pierce') throw new Error('Unsupported until a verified controller profile is available.');
  if (!['line', 'rapid', 'arc-cw', 'arc-ccw', 'lead-in', 'lead-out'].includes(kind)) throw new Error('Unsupported insertion type.');
  if (!['\n', '\r', '\r\n'].includes(ending)) throw new Error('Unsupported line ending.');
  if (!finite(values.endX) || !finite(values.endY)) throw new Error('A finite signed endpoint is required.');
  if (!finite(context.start.x) || !finite(context.start.y)) throw new Error('The current start point is invalid.');
  const code = kind === 'rapid' ? 'G00' : kind === 'arc-cw' ? 'G02' : kind === 'arc-ccw' ? 'G03' : 'G01';
  if (kind === 'lead-in' || kind === 'lead-out') {
    throw new Error('Lead-in and lead-out require verified contour and process context before insertion.');
  }
  if ((kind === 'arc-cw' || kind === 'arc-ccw') && (!finite(values.centerX) || !finite(values.centerY))) {
    throw new Error('Arc insertion requires finite I/J center values.');
  }
  if (values.endX === context.start.x && values.endY === context.start.y) throw new Error('Zero-length moves and full-circle insertion are not supported.');
  if (kind === 'arc-cw' || kind === 'arc-ccw') {
    const r1 = Math.hypot(context.start.x - values.centerX!, context.start.y - values.centerY!);
    const r2 = Math.hypot(values.endX - values.centerX!, values.endY - values.centerY!);
    if (!Number.isFinite(r1) || !Number.isFinite(r2) || r1 === 0 || Math.abs(r1 - r2) > Math.max(1e-9, r1 * 1e-10)) throw new Error('Arc start and endpoint must lie on the same nonzero-radius circle.');
  }
  const numberWord = (value: number) => {
    if (!Number.isFinite(value) || Math.abs(value) > 1e12 || (value !== 0 && Math.abs(value) < 1e-6)) throw new Error('Coordinate exceeds the supported plain-decimal range; no rounding was applied.');
    return String(Object.is(value, -0) ? 0 : value);
  };
  const coordinate = (axis: 'X' | 'Y', absolute: number, start: number) =>
    `${axis}${numberWord(context.distance === 'incremental' ? absolute - start : absolute)}`;
  const fields = [code, coordinate('X', values.endX, context.start.x), coordinate('Y', values.endY, context.start.y)];
  if (kind === 'arc-cw' || kind === 'arc-ccw') {
    const center = (axis: 'I' | 'J', value: number, start: number) =>
      `${axis}${numberWord(context.arcCenter === 'incremental' ? value - start : value)}`;
    fields.push(center('I', values.centerX!, context.start.x), center('J', values.centerY!, context.start.y));
  }
  return { lines: [fields.join(' ') + ending] };
}

export function validateInsertionIndex(lines: readonly string[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > lines.length) throw new Error('Insertion point is outside the source document.');
}
