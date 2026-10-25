import { buildMotionInsertion, type InsertionContext, type InsertionKind, type InsertionValues } from './motionInsertion.ts';
import type { TextDocument } from './gcodeDocument.ts';

/** Strict executable-word scan. Opaque syntax remains in the document but blocks insertion. */
export function sourceCode(line: string): string {
  let depth = 0;
  let code = '';
  for (const char of line) {
    if (char === ';' && depth === 0) break;
    if (char === '(') { depth++; continue; }
    if (char === ')') { if (!depth) throw new Error('Unmatched source comment.'); depth--; continue; }
    if (!depth) code += char;
  }
  if (depth) throw new Error('Unclosed source comment.');
  return code;
}

function words(line: string): [string, number][] {
  const code = sourceCode(line).trim();
  const pattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
  if (code.replace(pattern, '').trim()) throw new Error('Unsupported syntax, numbering or checksum requires a controller profile.');
  const tokens: [string, number][] = [...code.matchAll(pattern)].map(m => [m[1].toUpperCase(), Number(m[2])]);
  const seen = new Set<string>();
  const groups: Record<number, string> = { 0: 'motion', 1: 'motion', 2: 'motion', 3: 'motion', 20: 'units', 21: 'units', 90: 'distance', 91: 'distance', 90.1: 'center', 91.1: 'center' };
  for (const [key, value] of tokens) {
    if (!Number.isFinite(value)) throw new Error('Nonfinite source value.');
    if (!'GXYIJFM'.includes(key)) throw new Error(`Unsupported ${key} word: insertion requires a controller profile.`);
    const group = key === 'G' ? (groups[value] ?? `G${value}`) : key;
    if (seen.has(group)) throw new Error(`Ambiguous repeated ${group} words.`);
    seen.add(group);
    if (key === 'G' && ![0, 1, 2, 3, 17, 20, 21, 40, 49, 54, 80, 90, 91, 90.1, 91.1, 94].includes(value)) throw new Error(`G${value} needs a verified controller profile.`);
    if (key === 'M' && ![2, 5, 30].includes(value)) throw new Error(`M${value} process behavior is not verified for insertion.`);
  }
  return tokens;
}

export function inspectInsertion(document: TextDocument, after: number): { context: InsertionContext; feed: number; downstream: string; rejoin?: { x: number; y: number } } {
  if (!Number.isInteger(after) || after < 0 || after >= document.lines.length) throw new Error('Select a source line to insert after.');
  const records = document.lines.map(words);
  let units: InsertionContext['units'] | undefined;
  let distance: InsertionContext['distance'] | undefined;
  let arcCenter: InsertionContext['arcCenter'] | undefined;
  let position: { x: number; y: number } | undefined;
  let motion: number | undefined;
  let feed: number | undefined;
  const declared = new Set<number>();
  let processOff = false;
  for (let i = 0; i <= after; i++) {
    const tokens = records[i];
    const fields = new Map(tokens);
    if (tokens.some(([k, v]) => k === 'M' && [2, 30].includes(v))) throw new Error('Cannot insert after program end.');
    for (const [key, value] of tokens) {
      if (key === 'M' && value === 5) processOff = true;
      if (key === 'F') { if (value <= 0) throw new Error('Feed must be positive.'); feed = value; }
      if (key !== 'G') continue;
      if ([0, 1, 2, 3].includes(value)) motion = value;
      if ([17, 40, 49, 54, 80, 94].includes(value)) declared.add(value);
      if (value === 20 || value === 21) {
        const next = value === 20 ? 'inch' : 'mm';
        if (units && units !== next && position) throw new Error('Mid-program unit changes require verified position conversion.');
        units = next;
      }
      if (value === 90 || value === 91) distance = value === 90 ? 'absolute' : 'incremental';
      if (value === 90.1 || value === 91.1) arcCenter = value === 90.1 ? 'absolute' : 'incremental';
    }
    if (fields.has('X') || fields.has('Y')) {
      if (!units || !distance || motion === undefined) throw new Error('Units and endpoint/motion modes must precede coordinates.');
      if (!position && (distance !== 'absolute' || motion !== 0 || !fields.has('X') || !fields.has('Y'))) throw new Error('An explicit absolute XY rapid must establish the program position.');
      const end = {
        x: fields.has('X') ? fields.get('X')! + (distance === 'incremental' ? position!.x : 0) : position!.x,
        y: fields.has('Y') ? fields.get('Y')! + (distance === 'incremental' ? position!.y : 0) : position!.y,
      };
      if (motion === 2 || motion === 3) {
        if (!position || !arcCenter || !declared.has(17) || !fields.has('I') || !fields.has('J')) throw new Error('Source arcs require known XY start, plane, center mode and both I/J words.');
        buildMotionInsertion(motion === 2 ? 'arc-cw' : 'arc-ccw', { endX: end.x, endY: end.y, centerX: fields.get('I')! + (arcCenter === 'incremental' ? position.x : 0), centerY: fields.get('J')! + (arcCenter === 'incremental' ? position.y : 0) }, { units, distance, arcCenter, plane: 'XY', start: position });
      } else if (fields.has('I') || fields.has('J')) throw new Error('Center words on non-arc source records require review.');
      if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) throw new Error('Resolved source position is not finite.');
      position = end;
    } else if (fields.has('I') || fields.has('J')) throw new Error('Split arc records cannot be insertion boundaries.');
  }
  if (!units || !distance || !arcCenter || !position || !feed || !processOff || [17, 40, 49, 54, 80, 94].some(g => !declared.has(g))) {
    throw new Error('Insertion requires explicit units, G90/G91, arc-center mode, G17, G40, G49, G54, G80, G94, positive F, M5 and a known XY position. Missing state is not guessed.');
  }
  // Rejoin only at an explicit absolute XY rapid. Its start changes, but its endpoint
  // and modal state restore the original following path; never invent a return move.
  const next = records.slice(after + 1).find(record => record.length > 0);
  if (!next) throw new Error('Insert before a supported rapid or explicit program-end record.');
  const terminal = next.length === 1 && next[0][0] === 'M' && [2, 30].includes(next[0][1]);
  const nextFields = new Map(next);
  const absoluteNext = next.some(([k, v]) => k === 'G' && v === 90) || (distance === 'absolute' && !next.some(([k, v]) => k === 'G' && v === 91));
  const rapid = next.some(([k, v]) => k === 'G' && v === 0) && nextFields.has('X') && nextFields.has('Y') && absoluteNext && next.every(([k, v]) => 'XY'.includes(k) || (k === 'G' && [0, 90].includes(v)));
  if (!terminal && !rapid) throw new Error('Following record must explicitly restore G00 and absolute X/Y, or end the program. Implicit/downstream cutting moves are blocked.');
  if (terminal && records.slice(after + 1).filter(record => record.length > 0).length !== 1) throw new Error('Executable records after program end require review.');
  return { context: { units, distance, arcCenter, plane: 'XY', start: position }, feed, rejoin: rapid ? { x: nextFields.get('X')!, y: nextFields.get('Y')! } : undefined, downstream: terminal ? 'Inserted move ends before program termination.' : 'The next rapid starts at the new endpoint; its endpoint and subsequent motion mode are preserved. Review that connecting rapid.' };
}

export function planInsertion(document: TextDocument, after: number, kind: InsertionKind, values: InsertionValues) {
  const inspection = inspectInsertion(document, after);
  const ending = document.endings[after] || document.endings.find(Boolean) || '\n';
  const generated = buildMotionInsertion(kind, values, inspection.context, ending).lines[0].slice(0, -ending.length);
  const lines = [...document.lines];
  const endings = [...document.endings];
  if (!endings[after]) throw new Error('No following record boundary.');
  lines.splice(after + 1, 0, generated);
  endings.splice(after + 1, 0, ending);
  return { ...inspection, generated, document: { lines, endings, hasUtf8Bom: document.hasUtf8Bom } };
}
