import type { TextDocument } from './gcodeDocument.ts';

/**
 * Exact quarter-turns for G91 incremental machine vectors, not XY positions.
 * Only the caller-selected source lines change. Other lines and endings are
 * preserved byte-for-byte. CCW: (X,Y) => (-Y,X); CW: (X,Y) => (Y,-X).
 */
export type QuarterTurn = 'ccw' | 'cw';
type Axis = 'X' | 'Y' | 'I' | 'J';

const WORD = /([XYIJ])(\s*)([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
const G_WORD = /G\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;

function executablePrefix(line: string): string {
  let depth = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index] === ';' && depth === 0) return line.slice(0, index);
    if (line[index] === '(' && depth === 0) return line.slice(0, index);
    if (line[index] === '(') depth++;
    if (line[index] === ')' && depth > 0) depth--;
  }
  return line;
}

function negated(literal: string): string {
  // Canonical signed zero is necessary for the hand-computed fixture.
  if (Number(literal) === 0) return literal.replace(/^[+-]/, '');
  if (literal.startsWith('-')) return literal.slice(1);
  if (literal.startsWith('+')) return '-' + literal.slice(1);
  return '-' + literal;
}

function rewritePair(code: string, first: 'X' | 'I', second: 'Y' | 'J', turn: QuarterTurn): string {
  const matches = [...code.matchAll(WORD)].filter(match =>
    [first, second].includes(match[1].toUpperCase() as Axis)
  );
  const a = matches.filter(match => match[1].toUpperCase() === first);
  const b = matches.filter(match => match[1].toUpperCase() === second);
  if (a.length > 1 || b.length > 1) {
    throw new Error('Repeated coordinate word in a machine move; rotation stopped safely.');
  }
  if (!a.length && !b.length) return code;
  const updates: { start: number; end: number; replacement: string }[] = [];
  const replace = (match: RegExpMatchArray, letter: string, number: string) => {
    updates.push({
      start: match.index!,
      end: match.index! + match[0].length,
      replacement: (match[1] === match[1].toLowerCase() ? letter.toLowerCase() : letter) + match[2] + number,
    });
  };
  if (a.length && b.length) {
    replace(a[0], first, turn === 'ccw' ? negated(b[0][3]) : b[0][3]);
    replace(b[0], second, turn === 'ccw' ? a[0][3] : negated(a[0][3]));
  } else if (a.length) {
    replace(a[0], second, turn === 'ccw' ? a[0][3] : negated(a[0][3]));
  } else {
    replace(b[0], first, turn === 'ccw' ? negated(b[0][3]) : b[0][3]);
  }
  // Index-stable replacements, including optional spaces after axis letters.
  for (const update of updates.sort((left, right) => right.start - left.start)) {
    code = code.slice(0, update.start) + update.replacement + code.slice(update.end);
  }
  return code;
}

export function rotateG91PartVectors(
  document: TextDocument, sourceLines: readonly number[], turn: QuarterTurn,
): TextDocument {
  if (turn !== 'ccw' && turn !== 'cw') throw new Error('Only 90-degree clockwise/counterclockwise turns are supported.');
  if (document.sourceKind === 'dxf' || document.hasUtf8Bom) throw new Error('G91 rotation requires a compatible plain CNC text program.');
  const targets = new Set(sourceLines);
  if (targets.size === 0) throw new Error('Select a labelled part with machine moves before rotating.');
  if ([...targets].some(index => !Number.isInteger(index) || index < 0 || index >= document.lines.length)) {
    throw new Error('Selected part contains invalid source-line references.');
  }

  let distanceMode: 'absolute' | 'incremental' = 'absolute';
  let arcCenterMode: 'absolute' | 'incremental' = 'incremental';
  let motionMode: number | null = null;
  const lines = document.lines.slice();
  for (let index = 0; index < lines.length; index++) {
    const prefix = executablePrefix(lines[index]);
    for (const word of prefix.matchAll(G_WORD)) {
      const code = Number(word[1]);
      if (code === 90) distanceMode = 'absolute';
      if (code === 91) distanceMode = 'incremental';
      if (code === 90.1) arcCenterMode = 'absolute';
      if (code === 91.1) arcCenterMode = 'incremental';
      if ([0, 1, 2, 3].includes(code)) motionMode = code;
    }
    if (!targets.has(index)) continue;
    if (distanceMode !== 'incremental' || arcCenterMode !== 'incremental') {
      throw new Error('Part rotation requires G91 vectors with incremental I/J arc centers.');
    }
    if (motionMode === null) throw new Error('Selected part has no verified motion mode.');
    if (!/\b[XY]\s*[+-]?(?:\d|\.\d)/i.test(prefix) && !/[XY]\s*[+-]?(?:\d|\.\d)/i.test(prefix)) {
      throw new Error('Selected machine move has no editable X/Y vector.');
    }
    if (/[XYIJ]\s*#|[XYIJ]\s*\[/i.test(prefix)) {
      throw new Error('Parameterized vectors cannot be rotated safely.');
    }
    // The G91 part's X/Y and I/J belong to two independent vector pairs.
    let result = rewritePair(prefix, 'X', 'Y', turn);
    result = rewritePair(result, 'I', 'J', turn);
    if ((motionMode === 2 || motionMode === 3) && /\bR\s*[+-]?(?:\d|\.\d)/i.test(prefix)) {
      throw new Error('Radius-word arcs are not supported by this I/J rotation.');
    }
    lines[index] = result + lines[index].slice(prefix.length);
  }
  return { ...document, lines };
}
