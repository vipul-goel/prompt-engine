// Tests for scripts/eval/to-review.mjs on small synthetic results: two cases, one with two
// runs per arm and a failing indicator, traces that weren't kept, and one kept trace.
// Run with: node --test scripts/test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'to-review.mjs');

function run(result, scriptPath = script) {
  const dir = mkdtempSync(join(tmpdir(), 'pe-to-review-'));
  const resultPath = join(dir, 'result.json');
  writeFileSync(resultPath, JSON.stringify(result));
  const out = join(dir, 'review', 'iteration-1');
  const r = spawnSync(process.execPath, [scriptPath, resultPath, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return { dir, out };
}
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));

const judge = (evidence, passed = true) => ({ name: '01-judge', passed, scored: true, weight: 1, withOnly: false, explanation: 'judge votes: PASS PASS PASS', evidence });
const fired = (passed) => ({ name: '02-skill-fired', passed, scored: false, weight: 1, withOnly: true, explanation: 'Skill called 0x (expected 1..∞)' });

function synthetic(tracePath) {
  return {
    cases: [
      {
        name: 'case-a', promptMarkdown: 'Prompt A', dir: 'evals/case-a',
        graders: [
          { name: '01-judge', type: 'llm', config: { criteria: 'PASS if ...', focus: 'last_message' } },
          { name: '02-skill-fired', type: 'tool_used', config: { tool: 'Skill' } },
        ],
        arms: {
          with: [
            { score: 1, tracePath: '/nonexistent/pe-a1/trace.jsonl', durationSeconds: 10, costUsd: 0.1, graders: [judge('Reply A1'), fired(false)] },
            { score: 0, tracePath: '/nonexistent/pe-a2/trace.jsonl', durationSeconds: 11, costUsd: 0.1, graders: [judge('Reply A2', false), fired(true)] },
          ],
          without: [
            { score: 1, tracePath, durationSeconds: 5, costUsd: 0.02, graders: [judge('ignored: the trace wins'), fired(false)] },
            { score: 1, tracePath: null, durationSeconds: 6, costUsd: 0.02, graders: [judge('Reply A4'), fired(false)] },
          ],
        },
      },
      {
        name: 'case-b', promptMarkdown: 'Prompt B', dir: 'evals/case-b',
        graders: [{ name: '01-file', type: 'llm', config: { criteria: 'PASS if ...', focus: { source: 'file', path: 'x.md' } } }],
        arms: { with: [{ score: 1, tracePath: null, graders: [{ name: '01-file', passed: true, scored: true, weight: 1, evidence: 'the saved file' }] }] },
      },
    ],
  };
}

test('writes eval-<case>/<arm>/run-<k> folders with metadata in the case and arm folders', () => {
  const { dir, out } = run(synthetic(null));
  try {
    assert.deepEqual(readdirSync(out).sort(), ['eval-case-a', 'eval-case-b']);
    for (const arm of ['with_skill', 'without_skill']) {
      assert.deepEqual(readdirSync(join(out, 'eval-case-a', arm)).sort(), ['eval_metadata.json', 'run-1', 'run-2']);
      assert.deepEqual(json(join(out, 'eval-case-a', arm, 'eval_metadata.json')), json(join(out, 'eval-case-a', 'eval_metadata.json')));
    }
    assert.deepEqual(json(join(out, 'eval-case-a', 'eval_metadata.json')), { eval_id: 0, eval_name: 'case-a', prompt: 'Prompt A', assertions: ['01-judge', '02-skill-fired'] });
    assert.equal(json(join(out, 'eval-case-b', 'eval_metadata.json')).eval_id, 1);
    assert.deepEqual(readdirSync(join(out, 'eval-case-b', 'with_skill', 'run-1')).sort(), ['grading.json', 'outputs', 'timing.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('counts only scored graders and labels indicators', () => {
  const { dir, out } = run(synthetic(null));
  try {
    const g = json(join(out, 'eval-case-a', 'with_skill', 'run-1', 'grading.json'));
    assert.deepEqual(g.summary, { passed: 1, failed: 0, total: 1, pass_rate: 1 });
    assert.deepEqual(g.expectations.map((e) => [e.text, e.passed]), [['01-judge', true], ['02-skill-fired (indicator, not scored)', false]]);
    assert.deepEqual(json(join(out, 'eval-case-a', 'with_skill', 'run-2', 'grading.json')).summary, { passed: 0, failed: 1, total: 1, pass_rate: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('without a trace, takes the reply from a last-message judge, or says where to find it', () => {
  const { dir, out } = run(synthetic(null));
  try {
    const a1 = readFileSync(join(out, 'eval-case-a', 'with_skill', 'run-1', 'outputs', 'response.md'), 'utf8');
    assert.match(a1, /^Reply A1\n/);
    assert.match(a1, /trace was not kept[\s\S]*01-judge[\s\S]*100,000 characters/);
    assert.deepEqual(readdirSync(join(out, 'eval-case-a', 'with_skill', 'run-1', 'outputs')), ['response.md']);
    const b1 = readFileSync(join(out, 'eval-case-b', 'with_skill', 'run-1', 'outputs', 'response.md'), 'utf8');
    assert.doesNotMatch(b1, /the saved file/);
    assert.match(b1, /--keep-temp[\s\S]*report\.html/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an llm grader with no focus counts as one that read the last message', () => {
  const { dir, out } = run({
    cases: [{
      name: 'case-c', promptMarkdown: 'Prompt C',
      graders: [{ name: '01-judge', type: 'llm', config: { criteria: 'PASS if ...' } }],
      arms: { with: [{ score: 1, tracePath: null, graders: [judge('Reply C1')] }] },
    }],
  });
  try {
    assert.match(readFileSync(join(out, 'eval-case-c', 'with_skill', 'run-1', 'outputs', 'response.md'), 'utf8'), /^Reply C1\n\n\(The trace was not kept/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The files skill-creator's eval-viewer/generate_review.py leaves out of a run's outputs
// (METADATA_FILES, line 31, in anthropics/skills at 3d59511 and in the claude.ai example
// skill-creator of 2026-10-28). The tool calls go in a file the viewer shows (step 1e, B1.2.8).
const VIEWER_SKIPS = new Set(['transcript.md', 'user_notes.md', 'metrics.json']);

test('with a kept trace, takes the final reply and the tool calls from it', () => {
  const tdir = mkdtempSync(join(tmpdir(), 'pe-trace-'));
  const trace = join(tdir, 'trace.jsonl');
  writeFileSync(trace, [
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill: 'prompt-engine' } }] } },
    { type: 'result', result: 'Final reply', total_cost_usd: 0.05, duration_ms: 4000, usage: { input_tokens: 10, output_tokens: 5 } },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const { dir, out } = run(synthetic(trace));
  try {
    const run1 = join(out, 'eval-case-a', 'without_skill', 'run-1');
    assert.equal(readFileSync(join(run1, 'outputs', 'response.md'), 'utf8'), 'Final reply\n');
    assert.deepEqual(readdirSync(join(run1, 'outputs')).sort(), ['response.md', 'tool-calls.md']);
    assert.ok(!VIEWER_SKIPS.has('tool-calls.md'));
    assert.match(readFileSync(join(run1, 'outputs', 'tool-calls.md'), 'utf8'), /^- Skill \{"skill":"prompt-engine"\}/);
    assert.equal(json(join(run1, 'timing.json')).total_tokens, 15);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(tdir, { recursive: true, force: true }); }
});

test('takes the prompt that ran, else the checkout prompt.md without BOM, CRLF or front matter', () => {
  // A copy of the script in a scratch checkout, so it reads that checkout's evals/ folder.
  const repo = mkdtempSync(join(tmpdir(), 'pe-to-review-repo-'));
  mkdirSync(join(repo, 'scripts', 'eval'), { recursive: true });
  copyFileSync(script, join(repo, 'scripts', 'eval', 'to-review.mjs'));
  for (const name of ['case-c', 'case-d']) mkdirSync(join(repo, 'evals', name), { recursive: true });
  writeFileSync(join(repo, 'evals', 'case-c', 'prompt.md'), '\u{FEFF}---\r\ntags: [smoke]\r\n---\r\nLine one\r\nLine two\r\n');
  writeFileSync(join(repo, 'evals', 'case-d', 'prompt.md'), 'The checkout copy\n');
  const arms = { with: [{ score: 1, tracePath: null, graders: [] }] };
  const { dir, out } = run({
    cases: [{ name: 'case-c', graders: [], arms }, { name: 'case-d', promptMarkdown: 'The prompt that ran', graders: [], arms }],
  }, join(repo, 'scripts', 'eval', 'to-review.mjs'));
  try {
    assert.equal(json(join(out, 'eval-case-c', 'eval_metadata.json')).prompt, 'Line one\nLine two');
    assert.equal(json(join(out, 'eval-case-d', 'eval_metadata.json')).prompt, 'The prompt that ran');
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); }
});
