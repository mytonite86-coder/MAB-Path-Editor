import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectProgramSettings } from '../utils/programSettings.ts';

test('feed inspector retains changes and evidence lines without mutation or comment inference', () => {
  const lines = ['(170 amps F900 G20)', 'G21 G94 F120', 'F240 ; F900', 'G20 G95 F.5', 'G93 F2', 'M5 T3'];
  const before = JSON.stringify(lines);
  const result = inspectProgramSettings(lines);
  assert.deepEqual(result.feed.map(f => f.line), [2, 3, 4, 5]);
  assert.match(result.feed[0].description, /120 mm\/min/);
  assert.match(result.feed[1].description, /240 mm\/min/);
  assert.match(result.feed[2].description, /0.5 inch\/revolution/);
  assert.match(result.feed[3].description, /inverse minutes/);
  assert.match(result.amperage, /Unsupported until a verified controller profile/);
  assert.match(result.references, /No verified/);
  assert.equal(JSON.stringify(lines), before);
});

test('ambiguous, missing and unknown modal settings cannot become physical speed claims', () => {
  for (const lines of [['F120'], ['G21 G94', '#100=1', 'F120'], ['G21 G94', 'M98 P1', 'F120'], ['G20 G21 G94 F120']]) {
    assert.match(inspectProgramSettings(lines).feed.at(-1)!.description, /unresolved/);
  }
  assert.match(inspectProgramSettings(['G21 G94 F2 F3']).feed[0].description, /Ambiguous/);
  assert.equal(inspectProgramSettings(['(F2)', '; F3']).feed.length, 0);
});
