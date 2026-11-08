#!/usr/bin/env node
// Converts a `claude plugin eval` result (the --json file, or aggregate-result.json in the
// --output-dir folder; both hold the same JSON) into the workspace layout that skill-creator's
// scripts/aggregate_benchmark.py and eval-viewer/generate_review.py read, so people can read
// every output side by side and leave feedback. Checked against two versions by reading their
// code, not by running it: anthropics/skills at 3d59511, and the claude.ai example
// skill-creator of 2026-10-28.
//
//   node scripts/eval/to-review.mjs <result.json> <workspace>/iteration-N
//
// Layout: eval-<case>/eval_metadata.json, and per arm and run,
// eval-<case>/<with_skill|without_skill>/run-<k>/{outputs/response.md, grading.json, timing.json}.
// Folder names stay the same from one iteration to the next, because the viewer matches a
// run's feedback by its path; eval_id (the case's index in the result) is in the metadata.
// Each arm folder also gets a copy of eval_metadata.json, because the public viewer looks for
// it only in the run folder and its parent. With --keep-temp, the reply and the tool calls
// come from each run's trace. Without it, the reply comes from the evidence an llm judge of
// the last message was shown, when there is one.

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
const json = (v) => JSON.stringify(v, null, 2) + '\n';

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

// For a result without promptMarkdown (the prompt that ran): this checkout's prompt.md, with
// any BOM and CRLF line endings removed, without its front matter.
function promptFile(name) {
  const p = join(repo, 'evals', name, 'prompt.md');
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').trim() : '';
}

// The judge of an llm grader whose focus is the last message saw the final reply.
function replyFromEvidence(c, run) {
  const focusOf = new Map((c.graders ?? []).filter((g) => g.type === 'llm').map((g) => [g.name, g.config?.focus ?? 'last_message']));
  const g = (run.graders ?? []).find((x) => focusOf.get(x.name) === 'last_message' && typeof x.evidence === 'string');
  return g ? { text: g.evidence, from: g.name } : null;
}

result.cases.forEach((c, n) => {
  const caseDir = join(outDir, `eval-${c.name}`);
  mkdirSync(caseDir, { recursive: true });
  const metadata = json({
    eval_id: n,
    eval_name: c.name,
    prompt: c.promptMarkdown ?? promptFile(c.name),
    assertions: (c.graders ?? []).map((g) => g.name),
  });
  writeFileSync(join(caseDir, 'eval_metadata.json'), metadata);

  for (const [arm, runs] of Object.entries(c.arms ?? {})) {
    const armDir = join(caseDir, ARM_DIR[arm] ?? arm);
    mkdirSync(armDir, { recursive: true });
    writeFileSync(join(armDir, 'eval_metadata.json'), metadata);
    runs.forEach((run, i) => {
      const runDir = join(armDir, `run-${i + 1}`);
      mkdirSync(join(runDir, 'outputs'), { recursive: true });
      const fin = finalOf(run.tracePath);
      let text = fin?.text;
      if (text == null) {
        const ev = replyFromEvidence(c, run);
        text = ev
          ? `${ev.text}\n\n(The trace was not kept, so this reply is the evidence the judge of grader ${ev.from} was shown. The eval runner shortens a reply over 100,000 characters there to its first 80,000 and last 20,000.)`
          : '(The trace was not kept and no llm grader saw the final reply. Rerun with --keep-temp, or read the report.html in the results folder.)';
      }
      writeFileSync(join(runDir, 'outputs', 'response.md'), text + '\n');
      if (fin) writeFileSync(join(runDir, 'outputs', 'transcript.md'), fin.tools.map((t) => `- ${t}`).join('\n') + '\n');
      // Every grader is listed, but passed, failed and total count only scored ones: indicators
      // (with-only graders in a two-arm run) are labelled and left out, as in the CLI's score.
      // pass_rate is that run score, which weighs graders, so it differs from passed/total
      // when a grader's weight isn't 1.
      const expectations = (run.graders ?? []).map((g) => ({
        text: g.scored === false ? `${g.name} (indicator, not scored)` : g.name,
        passed: !!g.passed,
        evidence: g.explanation ?? '',
      }));
      const scored = (run.graders ?? []).filter((g) => g.scored !== false);
      const passed = scored.filter((g) => g.passed).length;
      writeFileSync(join(runDir, 'grading.json'), json({
        expectations,
        summary: { passed, failed: scored.length - passed, total: scored.length, pass_rate: run.score ?? (scored.length ? passed / scored.length : 0) },
      }));
      writeFileSync(join(runDir, 'timing.json'), json({
        total_tokens: fin?.tokens ?? null,
        duration_ms: fin?.durationMs ?? (run.durationSeconds != null ? run.durationSeconds * 1000 : null),
        total_duration_seconds: run.durationSeconds ?? (fin?.durationMs != null ? fin.durationMs / 1000 : null),
        cost_usd: run.costUsd ?? fin?.costUsd ?? null,
      }));
    });
  }
});
console.log(`wrote review workspace for ${result.cases.length} cases to ${outDir}`);
