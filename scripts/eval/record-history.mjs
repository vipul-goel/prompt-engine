#!/usr/bin/env node
// Records a real first turn with the plugin loaded and saves it as a sanitized
// `context.history_file` fixture for `claude plugin eval` follow-up cases.
//
//   node scripts/eval/record-history.mjs <out.jsonl> "<first user message>" [--model claude-sonnet-5-5]
//
// The recording is one billed `claude -p` call, capped at $1. Before that call, the script
// refuses a first message that looks private (sanitize.mjs's scan, plus this machine's home
// folder and name) and checks that Claude Code's transcript folder exists
// ($CLAUDE_CONFIG_DIR/projects or ~/.claude/projects). The call pre-approves the Skill tool,
// and Read only inside the skill's folder. The raw transcript holds local paths, request
// metadata and account details, so sanitize.mjs keeps only the user and assistant messages,
// rewrites the plugin, working and home folders and the session ID, and refuses to write the
// file if the result still looks private. Read the file before you commit it anyway. Later,
// scripts/build.mjs keeps the skill text and the reference files inside it up to date.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitize, scanText, machinePatterns, publicText } from './sanitize.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A Read rule for the skill's folder. In Claude Code's permission rules "//" starts an
// absolute path, and a Windows path is matched in POSIX form: C:\dev\repo becomes /c/dev/repo.
const skillReadRule = (dir) => `Read(/${dir.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`).replaceAll('\\', '/')}/skills/prompt-engine/**)`;

function main() {
  const [out, firstMessage, ...rest] = process.argv.slice(2);
  if (!out || !firstMessage) {
    console.error('usage: record-history.mjs <out.jsonl> "<first user message>" [--model <id>]');
    process.exit(2);
  }
  const model = rest[rest.indexOf('--model') + 1] && rest.includes('--model') ? rest[rest.indexOf('--model') + 1] : 'claude-sonnet-5-5';
  const home = homedir();
  const host = hostname();
  const allowText = publicText(repo);

  // Nothing that looks private goes into the billed call.
  const hits = scanText(firstMessage, { extra: machinePatterns({ home, host }), allowText });
  if (hits.length) {
    console.error(`the first message looks private, so nothing was sent:\n  ${hits.join('\n  ')}`);
    process.exit(1);
  }
  // Claude Code writes transcripts under $CLAUDE_CONFIG_DIR/projects, or ~/.claude/projects.
  const projectDirs = [...new Set([join(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects'), join(home, '.claude', 'projects')])];
  const where = `${projectDirs.join(' or ')} (a CLAUDE_CONFIG_DIR set only in a Claude Code settings file must also be set in this shell)`;
  if (!projectDirs.some((d) => existsSync(d))) {
    console.error(`no transcript folder at ${where}, so nothing was sent`);
    process.exit(1);
  }

  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pe-history-')));
  const env = { ...process.env };
  // Give the child its own session instead of inheriting the parent's.
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_REMOTE_SESSION_ID;

  const run = spawnSync('claude', [
    '-p', firstMessage,
    '--plugin-dir', repo,
    '--model', model,
    // Read is pre-approved only in the skill's folder, not everywhere. Claude Code's skills
    // documentation says the skill's own `allowed-tools: Read` pre-approves Read during the
    // turn that invokes it, so this rule alone doesn't keep other files out of the recording;
    // the scan in sanitize.mjs and a read of the file before it is committed are the checks.
    '--allowedTools', 'Skill', skillReadRule(repo),
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

  const file = projectDirs.filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).map((p) => join(d, p, `${sessionId}.jsonl`)))
    .find((p) => { try { return statSync(p).isFile(); } catch { return false; } });
  if (!file) {
    console.error(`transcript for session ${sessionId} not found under ${where}`);
    process.exit(1);
  }
  let text;
  try {
    text = sanitize(readFileSync(file, 'utf8'), { cwd, repo, home, host, allowText });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  writeFileSync(out, text);
  console.error(`wrote ${out}`);
  console.log(result.result);
}

// Run only as the entry point: importing this file must never start a billed recording.
// Compare real paths, as build.mjs does: import.meta.url is percent-encoded and free of
// symlinks, and process.argv[1] is neither.
const isEntry = () => {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; }
};
if (isEntry()) main();
