export type TextDocument = {
  lines: string[];
  endings: string[];
  hasUtf8Bom: boolean;
};

export type InterpretedPoint = {
  x: number;
  y: number;
  line?: number;
  mode?: 'G00' | 'G01' | 'G02' | 'G03';
  pierce?: boolean;
  commandEnd?: boolean;
};

const UTF8_BOM = new Uint8Array([0xef, 0xbb, 0xbf]);

export function detectContainer(bytes: Uint8Array): 'text' | 'dwg' | 'binary' {
  const signature = new TextDecoder('ascii').decode(bytes.slice(0, 6));
  if (/^AC10\d{2}$/.test(signature)) return 'dwg';

  const probeLength = Math.min(bytes.length, 8192);
  for (let index = 0; index < probeLength; index += 1) {
    if (bytes[index] === 0) return 'binary';
  }

  return 'text';
}

export function decodeTextDocument(bytes: Uint8Array): TextDocument {
  if (detectContainer(bytes) !== 'text') {
    throw new Error('The selected file is not a text controller program.');
  }

  const hasUtf8Bom =
    bytes.length >= 3 &&
    bytes[0] === UTF8_BOM[0] &&
    bytes[1] === UTF8_BOM[1] &&
    bytes[2] === UTF8_BOM[2];
  const body = hasUtf8Bom ? bytes.slice(3) : bytes;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(body);

  return parseTextDocument(text, hasUtf8Bom);
}

export function parseTextDocument(text: string, hasUtf8Bom = false): TextDocument {
  const lines: string[] = [];
  const endings: string[] = [];
  const linePattern = /([^\r\n]*)(\r\n|\n|\r)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(text)) !== null) {
    lines.push(match[1]);
    endings.push(match[2]);
    cursor = linePattern.lastIndex;
  }

  if (cursor < text.length || text.length === 0 || endings.length === 0) {
    lines.push(text.slice(cursor));
    endings.push('');
  }

  return { lines, endings, hasUtf8Bom };
}

export function serializeTextDocument(document: TextDocument): string {
  return document.lines
    .map((line, index) => line + (document.endings[index] ?? ''))
    .join('');
}

export function encodeTextDocument(document: TextDocument): Uint8Array {
  const body = new TextEncoder().encode(serializeTextDocument(document));
  if (!document.hasUtf8Bom) return body;

  const encoded = new Uint8Array(UTF8_BOM.length + body.length);
  encoded.set(UTF8_BOM, 0);
  encoded.set(body, UTF8_BOM.length);
  return encoded;
}

function codeBeforeComment(line: string): string {
  let parenthesisDepth = 0;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '(') parenthesisDepth += 1;
    if (character === ')' && parenthesisDepth > 0) parenthesisDepth -= 1;
    if (character === ';' && parenthesisDepth === 0) return line.slice(0, index);
  }

  return line;
}

function executableCode(line: string): string {
  return codeBeforeComment(line).replace(/\([^)]*\)/g, ' ');
}

export function interpretToolpath(lines: string[]): InterpretedPoint[] {
  const points: InterpretedPoint[] = [{ x: 0, y: 0 }];
  let current = { x: 0, y: 0 };
  let distanceMode: 'absolute' | 'incremental' = 'absolute';
  let arcCenterMode: 'absolute' | 'incremental' = 'incremental';
  let movementMode: InterpretedPoint['mode'];
  let needsPierce = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const words = [...executableCode(lines[lineIndex]).matchAll(
      /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
    )];
    if (words.length === 0) continue;

    for (const word of words) {
      if (word[1].toUpperCase() !== 'G') continue;
      const code = Number(word[2]);
      if (code === 90) distanceMode = 'absolute';
      if (code === 91) distanceMode = 'incremental';
      if (code === 90.1) arcCenterMode = 'absolute';
      if (code === 91.1) arcCenterMode = 'incremental';
      if (Number.isInteger(code) && code >= 0 && code <= 3) {
        movementMode = `G0${code}` as InterpretedPoint['mode'];
      }
    }

    if (!movementMode) continue;

    const values = new Map<string, number>();
    for (const word of words) values.set(word[1].toUpperCase(), Number(word[2]));
    if (!values.has('X') && !values.has('Y')) continue;

    const end = {
      x: values.has('X')
        ? distanceMode === 'incremental'
          ? current.x + values.get('X')!
          : values.get('X')!
        : current.x,
      y: values.has('Y')
        ? distanceMode === 'incremental'
          ? current.y + values.get('Y')!
          : values.get('Y')!
        : current.y,
    };

    if (movementMode === 'G02' || movementMode === 'G03') {
      const isPierce = needsPierce;
      needsPierce = false;
      const hasCenter = values.has('I') || values.has('J');
      const center = {
        x: arcCenterMode === 'incremental'
          ? current.x + (values.get('I') ?? 0)
          : (values.get('I') ?? current.x),
        y: arcCenterMode === 'incremental'
          ? current.y + (values.get('J') ?? 0)
          : (values.get('J') ?? current.y),
      };
      const radius = Math.hypot(current.x - center.x, current.y - center.y);

      if (!hasCenter || radius === 0) {
        points.push({ ...end, line: lineIndex, mode: movementMode, pierce: isPierce, commandEnd: true });
        current = end;
        continue;
      }

      const startAngle = Math.atan2(current.y - center.y, current.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);
      let sweep = endAngle - startAngle;
      if (movementMode === 'G02' && sweep > 0) sweep -= Math.PI * 2;
      if (movementMode === 'G03' && sweep < 0) sweep += Math.PI * 2;
      const steps = Math.max(12, Math.ceil(Math.abs(sweep) * radius * 8));

      for (let step = 1; step <= steps; step += 1) {
        const angle = startAngle + (sweep * step) / steps;
        points.push({
          x: center.x + Math.cos(angle) * radius,
          y: center.y + Math.sin(angle) * radius,
          line: lineIndex,
          mode: movementMode,
          pierce: isPierce && step === 1,
          commandEnd: step === steps,
        });
      }
      current = end;
      continue;
    }

    const isPierce = movementMode === 'G01' && needsPierce;
    if (movementMode === 'G00') needsPierce = true;
    if (movementMode === 'G01') needsPierce = false;
    points.push({ ...end, line: lineIndex, mode: movementMode, pierce: isPierce, commandEnd: true });
    current = end;
  }

  return points;
}

export function replaceWordValue(
  line: string,
  letter: 'G' | 'X' | 'Y' | 'I' | 'J',
  nextValue: string,
): string {
  if (nextValue.trim() === '') return line;

  const code = codeBeforeComment(line);
  const pattern = new RegExp(`(${letter}\\s*)([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, 'i');
  const match = pattern.exec(code);
  if (!match) return line;

  const valueStart = match.index + match[1].length;
  const valueEnd = valueStart + match[2].length;
  return line.slice(0, valueStart) + nextValue.trim() + line.slice(valueEnd);
}

export function readMotionBlockValues(
  lines: string[],
  selectedLine: number,
): Partial<Record<'G' | 'X' | 'Y' | 'I' | 'J', string>> {
  if (selectedLine < 0 || selectedLine >= lines.length) return {};

  const movement = /\bG0?[0123]\b/i;
  let start = selectedLine;
  while (start > 0 && !movement.test(executableCode(lines[start]))) start -= 1;
  if (!movement.test(executableCode(lines[start]))) start = selectedLine;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (movement.test(executableCode(lines[index]))) {
      end = index;
      break;
    }
  }

  const values: Partial<Record<'G' | 'X' | 'Y' | 'I' | 'J', string>> = {};
  const wanted = new Set(['G', 'X', 'Y', 'I', 'J']);
  for (let index = start; index < end; index += 1) {
    for (const match of executableCode(lines[index]).matchAll(
      /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi
    )) {
      const letter = match[1].toUpperCase();
      if (wanted.has(letter) && values[letter as keyof typeof values] === undefined) {
        values[letter as keyof typeof values] = match[2];
      }
    }
  }

  return values;
}

export function patchMotionBlock(
  lines: string[],
  selectedLine: number,
  edits: Partial<Record<'G' | 'X' | 'Y' | 'I' | 'J', string>>,
): string[] {
  if (selectedLine < 0 || selectedLine >= lines.length) return lines;

  const movement = /\bG0?[0123]\b/i;
  let start = selectedLine;
  while (start > 0 && !movement.test(codeBeforeComment(lines[start]))) start -= 1;
  if (!movement.test(codeBeforeComment(lines[start]))) start = selectedLine;

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (movement.test(codeBeforeComment(lines[index]))) {
      end = index;
      break;
    }
  }

  const patched = [...lines];
  for (const [letter, value] of Object.entries(edits) as [keyof typeof edits, string][]) {
    if (!value?.trim()) continue;
    for (let index = start; index < end; index += 1) {
      const next = replaceWordValue(patched[index], letter, value);
      if (next !== patched[index]) {
        patched[index] = next;
        break;
      }
    }
  }

  return patched;
}
