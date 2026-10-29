#!/usr/bin/env node
// Records a real first turn with the plugin loaded and saves it as a sanitized
// `context.history_file` fixture for `claude plugin eval` follow-up cases.
//
//   node scripts/eval/record-history.mjs <out.jsonl> "<first user message>" [--model claude-sonnet-5-5]
//
// The raw session transcript contains local paths, request metadata and injected
// account context (for example the signed-in user's email), so only user and
// assistant messages are kept, paths are rewritten, and the result is checked
// for e-mail addresses before it is written.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const [out, firstMessage, ...rest] = process.argv.slice(2);
if (!out || !firstMessage) {
  console.error('usage: record-history.mjs <out.jsonl> "<first user message>" [--model <id>]');
  process.exit(2);
}
const model = rest[rest.indexOf('--model') + 1] && rest.includes('--model') ? rest[rest.indexOf('--model') + 1] : 'claude-sonnet-5-5';

const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pe-history-')));
const env = { ...process.env };
// Give the child its own session instead of inheriting the parent's.
delete env.CLAUDE_CODE_SESSION_ID;
delete env.CLAUDE_CODE_REMOTE_SESSION_ID;

const run = spawnSync('claude', [
  '-p', firstMessage,
  '--plugin-dir', repo,
  '--model', model,
  '--allowedTools', 'Skill', 'Read',
  '--output-format', 'json',
  '--max-budget-usd', '1',
], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (run.status !== 0) {
  console.error(run.stderr || run.stdout);
  process.exit(1);
}
const result = JSON.parse(run.stdout);
const sessionId = result.session_id;
console.error(`recorded session ${sessionId} (cost $${result.total_cost_usd?.toFixed?.(3)})`);

const projects = join(homedir(), '.claude', 'projects');
const file = readdirSync(projects)
  .map((d) => join(projects, d, `${sessionId}.jsonl`))
  .find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
if (!file) throw new Error(`transcript for session ${sessionId} not found under ${projects}`);

writeFileSync(out, sanitize(readFileSync(file, 'utf8'), { cwd, repo }));
console.error(`wrote ${out}`);
console.log(result.result);

export function sanitize(raw, { cwd, repo }) {
  const FIXED_SESSION = '00000000-0000-4000-8000-000000000001';
  const events = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const kept = new Set(events.filter((e) => e.type === 'user' || e.type === 'assistant').map((e) => e.uuid));
  const byUuid = new Map(events.map((e) => [e.uuid, e]));
  // Re-link each kept event to its nearest kept ancestor, skipping dropped attachments.
  const nearestKept = (uuid) => {
    let cur = uuid;
    while (cur && !kept.has(cur)) cur = byUuid.get(cur)?.parentUuid ?? null;
    return cur ?? null;
  };
  const KEEP_KEYS = ['type', 'uuid', 'parentUuid', 'isSidechain', 'message', 'toolUseResult', 'sourceToolAssistantUUID', 'isMeta', 'timestamp', 'version', 'userType'];
  const lines = [];
  for (const e of events) {
    if (!kept.has(e.uuid)) continue;
    const o = {};
    for (const k of KEEP_KEYS) if (k in e) o[k] = e[k];
    o.parentUuid = nearestKept(e.parentUuid);
    o.sessionId = FIXED_SESSION;
    o.cwd = '/workspace';
    lines.push(JSON.stringify(o));
  }
  let text = lines.join('\n') + '\n';
  text = text.split(repo).join('/plugin').split(cwd).join('/workspace');
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text.replace(/noreply@anthropic\.com/g, ''))) {
    throw new Error('sanitized transcript still contains an e-mail-like string; refusing to write it');
  }
  return text;
}
