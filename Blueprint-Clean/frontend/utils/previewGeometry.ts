import type { InterpretedPoint } from './gcodeDocument';

export function fitPreview(points: InterpretedPoint[], width: number, height: number, zoom = 1, panX = 0, panY = 0) {
  const finite = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!finite.length) finite.push({ x: 0, y: 0 });
  const xs = finite.map(point => point.x);
  const ys = finite.map(point => point.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(Math.max(1, width - 40) / (maxX - minX || 1), Math.max(1, height - 40) / (maxY - minY || 1)) * zoom;
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  return {
    minX, maxX, minY, maxY, scale,
    project: (point: { x: number; y: number }) => ({
      x: width / 2 + (point.x - centerX) * scale + panX,
      y: height / 2 - (point.y - centerY) * scale + panY,
    }),
  };
}

export function selectedMoveMeasurements(points: InterpretedPoint[], line: number) {
  const first = points.findIndex(point => point.line === line);
  if (first <= 0) return null;
  const last = points.findLastIndex(point => point.line === line);
  const start = points[first - 1], end = points[last];
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) return null;
  const dx = end.x - start.x, dy = end.y - start.y;
  return { start, end, dx, dy, endpointDistance: Math.hypot(dx, dy), mode: end.mode };
}
