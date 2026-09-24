import type {
  ControllerBoundaryInterpreter,
  ProgramContour,
  ProgramEvent,
  ProgramPart,
} from './gcodeDocument.ts';

const exactExecutable = (event: ProgramEvent, value: string) => event.executable.toUpperCase() === value;
const hasG = (event: ProgramEvent, code: number) => event.gCodes.includes(code);
const hasM = (event: ProgramEvent, code: number) => event.mCodes.includes(code);
const isRapid = (event: ProgramEvent) => event.geometry?.mode === 'G00';

const unsupported = (reason: string) => ({ status: 'unsupported' as const, reason });

/**
 * Fixture-calibrated profile for the supplied Messer/programmer output family.
 * M21/M20 are treated only as observed sequence boundaries; no universal
 * controller meaning is assigned to them.
 */
export const messerProgrammedNestProfile: ControllerBoundaryInterpreter = {
  id: 'messer-programmer-g70-g91-m21-m20-v1',
  reconstruct(events) {
    const meaningful = events.filter(event => event.type !== 'empty');
    if (
      meaningful.length < 5 ||
      !exactExecutable(meaningful[0], '%') ||
      !exactExecutable(meaningful[1], 'G70') ||
      !exactExecutable(meaningful[2], 'G91') ||
      !exactExecutable(meaningful[3], 'M86') ||
      !hasM(meaningful.at(-1)!, 30)
    ) return unsupported('Program does not match the calibrated Messer G70/G91/M86/M21/M20 family.');

    const headerEnd = meaningful[3].order;
    const programEnd = meaningful.at(-1)!.order;
    const parts: ProgramPart[] = [];
    const contours: ProgramContour[] = [];
    const repeatedStructures: string[] = [];
    let cursor = headerEnd + 1;

    while (cursor < programEnd) {
      const start = cursor;
      if (!isRapid(events[cursor])) return unsupported('Expected a placement rapid at the start of each programmed part.');
      let rapidCount = 0;
      while (cursor < programEnd && isRapid(events[cursor])) { rapidCount += 1; cursor += 1; }
      if (rapidCount !== 2) return unsupported('Calibrated parts require exactly two leading placement/context rapids.');

      const sequenceComment = events.slice(cursor, programEnd).find(event => event.comments.some(comment => /^Seq\s+\d+\s+-\s+.+/i.test(comment.trim())));
      if (!sequenceComment) return unsupported('A calibrated sequence comment was not found for a programmed part.');
      if (sequenceComment.order < cursor) return unsupported('Sequence comment ordering is invalid.');

      let g41 = -1;
      let m21 = -1;
      let m20 = -1;
      let g40 = -1;
      for (let order = cursor; order < programEnd; order += 1) {
        const event = events[order];
        if (isRapid(event)) break;
        if (g41 < 0 && hasG(event, 41)) g41 = order;
        if (m21 < 0 && hasM(event, 21)) m21 = order;
        if (m20 < 0 && hasM(event, 20)) m20 = order;
        if (hasG(event, 40)) { g40 = order; break; }
      }
      if (!(sequenceComment.order < g41 && g41 < m21 && m21 < m20 && m20 < g40)) {
        return unsupported('Part sequence does not match comment -> G41 -> M21 -> M20 -> G40 ordering.');
      }
      const cutting = events.slice(m21 + 1, m20).filter(event => event.geometry);
      if (!cutting.length || cutting.some(event => !['G01', 'G02', 'G03'].includes(event.geometry!.mode))) {
        return unsupported('Observed M21/M20 boundaries do not contain only supported cutting motion.');
      }

      const partNumber = parts.length + 1;
      const partId = `messer-part-${partNumber}`;
      const contour: ProgramContour = {
        id: `${partId}-contour-1`,
        ownership: 'verified',
        kind: 'unknown',
        eventOrders: Array.from({ length: m20 - m21 + 1 }, (_, index) => m21 + index),
        sourceLineSpans: [{ start: events[m21].sourceLine, end: events[m20].sourceLine }],
      };
      const orderedEventOrders = Array.from({ length: g40 - start + 1 }, (_, index) => start + index);
      const part: ProgramPart = {
        id: partId,
        ownership: 'verified',
        contours: [contour],
        processEventOrders: orderedEventOrders.filter(order => events[order].mCodes.length > 0),
        orderedEventOrders,
        sourceLineSpans: [{ start: events[start].sourceLine, end: events[g40].sourceLine }],
      };
      parts.push(part);
      contours.push(contour);
      repeatedStructures.push(events.slice(start + 1, g40 + 1).map(event => {
        if (event.geometry) return `motion:${event.geometry.mode}`;
        if (event.mCodes.length) return `M:${event.mCodes.join(',')}`;
        return event.rawSourceLine;
      }).join('\n'));
      cursor = g40 + 1;
    }

    if (parts.length < 2) return unsupported('A programmed nest requires repeated, independently bounded part sequences.');
    if (!repeatedStructures.every(body => body === repeatedStructures[0])) {
      return unsupported('Repeated programmed-part structures do not match the calibrated family contract.');
    }
    return { status: 'verified' as const, parts, contours };
  },
};
