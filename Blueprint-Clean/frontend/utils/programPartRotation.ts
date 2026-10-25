import {
  interpretStructuredToolpath,
  parseProgramEvents,
  reconstructProgramStructure,
  type ProgramStructure,
  type TextDocument,
} from './gcodeDocument.ts';
import { messerProgrammedNestProfile } from './messerProgrammedNest.ts';

const EPSILON = 1e-10;

function rotatedVector(x: number, y: number, radians: number) {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return { x: x * cosine - y * sine, y: x * sine + y * cosine };
}

function rotatedPoint(point: { x: number; y: number }, pivot: { x: number; y: number }, radians: number) {
  const vector = rotatedVector(point.x - pivot.x, point.y - pivot.y, radians);
  return { x: pivot.x + vector.x, y: pivot.y + vector.y };
}

function formatted(value: number): string {
  const rounded = Math.abs(value) < EPSILON ? 0 : Number(value.toFixed(6));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function codeEnd(line: string): number {
  let depth = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === ';' && depth === 0) return index;
    if (line[index] === '(' && depth === 0) return index;
    if (line[index] === '(') depth += 1;
    if (line[index] === ')' && depth > 0) depth -= 1;
  }
  return line.length;
}

function rewriteWords(line: string, values: Partial<Record<'X' | 'Y' | 'I' | 'J', number>>): string {
  let result = line;
  for (const [letter, numeric] of Object.entries(values) as ['X' | 'Y' | 'I' | 'J', number][]) {
    const end = codeEnd(result);
    const code = result.slice(0, end);
    const matches = [...code.matchAll(new RegExp(`(${letter}\\s*)([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'gi'))];
    if (matches.length > 1) throw new Error(`${letter} occurs more than once on source line; rotation stopped safely.`);
    const next = formatted(numeric);
    if (matches.length === 1) {
      const match = matches[0];
      const start = match.index! + match[1].length;
      result = result.slice(0, start) + next + result.slice(start + match[2].length);
    } else {
      const insertion = codeEnd(result);
      result = result.slice(0, insertion).replace(/\s+$/, '') + `${letter}${next}` + result.slice(insertion);
    }
  }
  return result;
}

export function verifiedPartPivot(lines: string[], structure: ProgramStructure, partId: string) {
  if (structure.status !== 'verified') throw new Error('Whole-part rotation requires verified part identity.');
  const part = structure.parts.find(candidate => candidate.id === partId);
  if (!part) throw new Error('Select a verified programmed part before rotating.');
  const contourIds = new Set(part.contours.map(contour => contour.id));
  const points = interpretStructuredToolpath(lines, structure).filter(point => point.contourId && contourIds.has(point.contourId));
  if (!points.length) throw new Error('Selected part has no verified contour geometry for a stable pivot.');
  return points.reduce((center, point) => ({ x: center.x + point.x / points.length, y: center.y + point.y / points.length }), { x: 0, y: 0 });
}

export function rotateVerifiedProgramPart(
  document: TextDocument,
  structure: ProgramStructure,
  partId: string,
  degrees: number,
): TextDocument {
  if (!Number.isFinite(degrees) || degrees === 0) throw new Error('Rotation angle must be a nonzero finite number.');
  if (structure.status !== 'verified' || structure.controllerProfileId !== messerProgrammedNestProfile.id) {
    throw new Error('Whole-part rotation is unsupported without the calibrated Messer/programmer profile.');
  }
  const part = structure.parts.find(candidate => candidate.id === partId);
  if (!part) throw new Error('Select a verified programmed part before rotating.');
  const pivot = verifiedPartPivot(document.lines, structure, partId);
  const radians = degrees * Math.PI / 180;
  const lines = [...document.lines];
  const geometryOrders = part.orderedEventOrders.filter(order => structure.events[order].geometry);
  const firstGeometryOrder = geometryOrders[0];

  for (const order of geometryOrders) {
    const event = structure.events[order];
    const geometry = event.geometry;
    if (!geometry) continue;
    if (geometry.distanceMode !== 'incremental' || geometry.arcCenterMode !== 'incremental') {
      throw new Error('This rotation implementation is limited to calibrated G91 geometry with incremental I/J.');
    }
    const transformedStart = order === firstGeometryOrder ? geometry.start : rotatedPoint(geometry.start, pivot, radians);
    const transformedEnd = rotatedPoint(geometry.end, pivot, radians);
    const updates: Partial<Record<'X' | 'Y' | 'I' | 'J', number>> = {
      X: transformedEnd.x - transformedStart.x,
      Y: transformedEnd.y - transformedStart.y,
    };
    if (geometry.mode === 'G02' || geometry.mode === 'G03') {
      if (geometry.i === undefined && geometry.j === undefined) throw new Error('Arc center data is missing; rotation stopped safely.');
      const center = rotatedVector(geometry.i ?? 0, geometry.j ?? 0, radians);
      updates.I = center.x;
      updates.J = center.y;
    }
    lines[event.sourceLine] = rewriteWords(lines[event.sourceLine], updates);
  }

  // G91 chains every later part from the selected part's final machine position.
  // Compensate only the next part's leading placement rapid so neighboring cut
  // geometry remains fixed while the selected part rotates in place.
  const partIndex = structure.parts.findIndex(candidate => candidate.id === partId);
  const nextPart = structure.parts[partIndex + 1];
  if (nextPart) {
    const selectedLast = structure.events[geometryOrders.at(-1)!].geometry!;
    const interimEvents = parseProgramEvents(lines);
    const interimLast = interimEvents[geometryOrders.at(-1)!].geometry!;
    const nextFirstOrder = nextPart.orderedEventOrders.find(order => structure.events[order].geometry);
    if (nextFirstOrder === undefined || structure.events[nextFirstOrder].geometry?.mode !== 'G00') {
      throw new Error('The following part has no verified leading placement rapid for G91 compensation.');
    }
    const nextGeometry = structure.events[nextFirstOrder].geometry!;
    lines[structure.events[nextFirstOrder].sourceLine] = rewriteWords(lines[structure.events[nextFirstOrder].sourceLine], {
      X: (nextGeometry.x ?? 0) + selectedLast.end.x - interimLast.end.x,
      Y: (nextGeometry.y ?? 0) + selectedLast.end.y - interimLast.end.y,
    });
  }

  const next = { ...document, lines };
  const verified = reconstructProgramStructure(lines, messerProgrammedNestProfile);
  if (verified.status !== 'verified' || verified.parts.length !== structure.parts.length) {
    throw new Error('Rotated output no longer satisfies the calibrated Messer program structure.');
  }
  return next;
}
