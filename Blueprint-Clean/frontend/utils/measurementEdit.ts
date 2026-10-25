import { interpretToolpath, patchSourceLine } from './gcodeDocument.ts';

/** Use the same source-word edit for numeric review and Apply; never mutate input. */
export function reviewMeasurementEdit(lines: readonly string[], line: number, fields: Parameters<typeof patchSourceLine>[1]) {
  if (!Number.isInteger(line) || line < 0 || line >= lines.length) throw new Error('Select a source line.');
  const source = patchSourceLine(lines[line], fields);
  const updated = [...lines];
  updated[line] = source;
  const points = interpretToolpath(updated.slice(0, line + 1));
  const first = points.findIndex(point => point.line === line);
  const end = points.findLast(point => point.line === line);
  if (first <= 0 || !end) throw new Error('No supported XY movement on this source line.');
  const start = points[first - 1];
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error('Movement coordinates are not finite.');
  return { source, updated, start, end, dx: end.x - start.x, dy: end.y - start.y };
}
