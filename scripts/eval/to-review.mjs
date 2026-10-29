#!/usr/bin/env node
// Converts a `claude plugin eval --json <file> --keep-temp` result into the
// workspace layout read by skill-creator's aggregate_benchmark.py and
// eval-viewer/generate_review.py, so people can read every output side by side
// and leave feedback.
//
//   node scripts/eval/to-review.mjs <result.json> <workspace>/iteration-N
//
// Layout written per case: <case>/eval_metadata.json and, per arm,
// <case>/<with_skill|without_skill>[/run-K]/{outputs/response.md, grading.json, timing.json}.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [resultPath, outDir] = process.argv.slice(2);
if (!resultPath || !outDir) {
  console.error('usage: to-review.mjs <result.json> <workspace>/iteration-N');
  process.exit(2);
}

const result = JSON.parse(readFileSync(resultPath, 'utf8'));
const ARM_DIR = { with: 'with_skill', without: 'without_skill' };

const stripFrontmatter = (text) => text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();

function finalOf(tracePath) {
  if (!tracePath || !existsSync(tracePath)) return null;
  const events = readFileSync(tracePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const res = [...events].reverse().find((e) => e.type === 'result');
  const tools = [];
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    for (const c of e.message?.content ?? []) {
      if (c.type === 'tool_use') tools.push(`${c.name} ${JSON.stringify(c.input).slice(0, 160)}`);
    }
  }
  const u = res?.usage ?? {};
  return {
    text: res?.result ?? '(no final message)',
    costUsd: res?.total_cost_usd ?? null,
    durationMs: res?.duration_ms ?? null,
    tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    tools,
  };
}

for (const c of result.cases) {
  const caseDir = join(outDir, c.name);
  mkdirSync(caseDir, { recursive: true });
  const promptFile = join(repo, 'evals', c.name, 'prompt.md');
  const prompt = existsSync(promptFile) ? stripFrontmatter(readFileSync(promptFile, 'utf8')) : c.promptMarkdown ?? '';
  const assertions = (c.graders ?? []).map((g) => g.name);
  writeFileSync(join(caseDir, 'eval_metadata.json'), JSON.stringify({ eval_name: c.name, prompt, assertions }, null, 2));

  for (const [arm, runs] of Object.entries(c.arms ?? {})) {
    runs.forEach((run, i) => {
      const runDir = runs.length > 1 ? join(caseDir, ARM_DIR[arm], `run-${i + 1}`) : join(caseDir, ARM_DIR[arm]);
      mkdirSync(join(runDir, 'outputs'), { recursive: true });
      const fin = finalOf(run.tracePath);
      writeFileSync(join(runDir, 'outputs', 'response.md'), (fin?.text ?? '(trace not kept; rerun with --keep-temp)') + '\n');
      if (fin) writeFileSync(join(runDir, 'outputs', 'transcript.md'), fin.tools.map((t) => `- ${t}`).join('\n') + '\n');
      const expectations = (run.graders ?? []).map((g) => ({
        text: g.scored === false ? `${g.name} (indicator, not scored)` : g.name,
        passed: !!g.passed,
        evidence: g.explanation ?? '',
      }));
      const passed = expectations.filter((e) => e.passed).length;
      writeFileSync(join(runDir, 'grading.json'), JSON.stringify({
        expectations,
        summary: { passed, failed: expectations.length - passed, total: expectations.length, pass_rate: run.score ?? (expectations.length ? passed / expectations.length : 0) },
      }, null, 2));
      writeFileSync(join(runDir, 'timing.json'), JSON.stringify({
        total_tokens: fin?.tokens ?? null,
        duration_ms: fin?.durationMs ?? (run.durationSeconds != null ? run.durationSeconds * 1000 : null),
        total_duration_seconds: run.durationSeconds ?? (fin?.durationMs != null ? fin.durationMs / 1000 : null),
        cost_usd: run.costUsd ?? fin?.costUsd ?? null,
      }, null, 2));
    });
  }
}
console.log(`wrote review workspace for ${result.cases.length} cases to ${outDir}`);
