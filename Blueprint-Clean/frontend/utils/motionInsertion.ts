export type InsertionKind = 'line' | 'arc-cw' | 'arc-ccw' | 'rapid' | 'lead-in' | 'lead-out';

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
  if (!finite(values.endX) || !finite(values.endY)) throw new Error('A finite signed endpoint is required.');
  if (!finite(context.start.x) || !finite(context.start.y)) throw new Error('The current start point is invalid.');
  const code = kind === 'rapid' ? 'G00' : kind === 'arc-cw' ? 'G02' : kind === 'arc-ccw' ? 'G03' : 'G01';
  if (kind === 'lead-in' || kind === 'lead-out') {
    throw new Error('Lead-in and lead-out require verified contour and process context before insertion.');
  }
  if ((kind === 'arc-cw' || kind === 'arc-ccw') && (!finite(values.centerX) || !finite(values.centerY))) {
    throw new Error('Arc insertion requires finite I/J center values.');
  }
  const coordinate = (axis: 'X' | 'Y', absolute: number, start: number) =>
    `${axis}${(context.distance === 'incremental' ? absolute - start : absolute).toFixed(4).replace(/\.?0+$/, '')}`;
  const fields = [code, coordinate('X', values.endX, context.start.x), coordinate('Y', values.endY, context.start.y)];
  if (kind === 'arc-cw' || kind === 'arc-ccw') {
    const center = (axis: 'I' | 'J', value: number, start: number) =>
      `${axis}${(context.arcCenter === 'incremental' ? value - start : value).toFixed(4).replace(/\.?0+$/, '')}`;
    fields.push(center('I', values.centerX!, context.start.x), center('J', values.centerY!, context.start.y));
  }
  return { lines: [fields.join(' ') + ending] };
}

export function validateInsertionIndex(lines: readonly string[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > lines.length) throw new Error('Insertion point is outside the source document.');
}
