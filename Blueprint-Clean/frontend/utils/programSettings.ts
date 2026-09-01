import { sourceCode } from './insertionPlan.ts';

export type SettingEvidence = { line: number; raw: string; description: string };

/** Read-only source evidence. Never infer controller process settings from comments. */
export function inspectProgramSettings(lines: readonly string[]) {
  const feed: SettingEvidence[] = [];
  const unresolved: SettingEvidence[] = [];
  let units: string | undefined;
  let mode: number | undefined;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    let code: string;
    try { code = sourceCode(line); } catch {
      unresolved.push({ line: lineNumber, raw: line, description: 'Malformed comment; subsequent modal state is uncertain.' });
      units = undefined; mode = undefined; return;
    }
    // Percent-only records are standard program delimiters, not process data.
    if (code.trim() === '%') return;
    const pattern = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
    const tokens = [...code.matchAll(pattern)];
    if (code.replace(pattern, '').trim()) {
      unresolved.push({ line: lineNumber, raw: line, description: 'Unsupported syntax: settings and subsequent modal state are unresolved.' });
      units = undefined; mode = undefined; return;
    }
    const gs = tokens.filter(m => m[1].toUpperCase() === 'G').map(m => Number(m[2]));
    const unitWords = gs.filter(g => g === 20 || g === 21);
    const modeWords = gs.filter(g => [93, 94, 95].includes(g));
    if (unitWords.length) units = unitWords.length === 1 ? unitWords[0] === 20 ? 'inch' : 'mm' : undefined;
    if (modeWords.length) mode = modeWords.length === 1 ? modeWords[0] : undefined;
    // Control flow or unknown instructions can invalidate any apparent modal scope.
    const unknownG = gs.some(g => ![0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 40, 49, 54, 80, 90, 91, 90.1, 91.1, 93, 94, 95].includes(g));
    const unknownM = tokens.some(m => m[1].toUpperCase() === 'M' && ![2, 3, 4, 5, 30].includes(Number(m[2])));
    if (unknownG || unknownM) { units = undefined; mode = undefined; }
    const fWords = tokens.filter(m => m[1].toUpperCase() === 'F');
    for (const token of fWords) {
      const value = Number(token[2]);
      const description = fWords.length !== 1 || !Number.isFinite(value) || value <= 0 ? 'Ambiguous or invalid feed value.' : mode === 93 ? `${value} inverse minutes (G93); applies to its motion block, not a linear speed.` : units && (mode === 94 || mode === 95) ? `${value} ${units}/${mode === 94 ? 'min (G94)' : 'revolution (G95)'}; this interpretation lasts until feed, units or feed mode changes, or state becomes unresolved.` : `${value}; units/feed mode unresolved, not a known physical speed.`;
      feed.push({ line: lineNumber, raw: token[0], description });
    }
    for (const token of tokens.filter(m => ['M', 'T', 'S', 'H', 'D', 'P', 'Q'].includes(m[1].toUpperCase()))) {
      unresolved.push({ line: lineNumber, raw: token[0], description: 'Controller/tool/process token; no verified cut-chart, amperage or overburn mapping.' });
    }
    if (unknownG) unresolved.push({ line: lineNumber, raw: line, description: 'Unsupported G instruction; subsequent settings scope is unresolved.' });
    if (tokens.some(m => m[1].toUpperCase() === 'M' && [2, 30].includes(Number(m[2])))) { units = undefined; mode = undefined; }
  });
  const unsupported = 'Unsupported until a verified controller profile is available. Presence/value cannot be determined from generic tokens; not evidence of absence.';
  return { feed, unresolved,
    amperage: unsupported,
    nozzle: unsupported,
    heightControl: unsupported,
    pierce: unsupported,
    rapidSpeed: 'No supported programmed rapid-speed mapping. F words are not assumed to control rapid speed.',
    overburn: `${unsupported} Dwell and generic commands are not treated as overburn.`,
    references: 'No verified process/cut-chart reference parser. Raw tokens below are evidence for review, not confirmed process settings.',
  };
}
