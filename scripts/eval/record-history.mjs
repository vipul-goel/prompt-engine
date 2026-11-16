#!/usr/bin/env node
// Records a real first turn with the plugin loaded and saves it as a sanitized
// `context.history_file` fixture for `claude plugin eval` follow-up cases.
//
//   node scripts/eval/record-history.mjs <out.jsonl> "<first user message>" [--model claude-sonnet-5-5]
//
// The recording is one billed `claude -p` call, capped at $1. Before that call, the script reads
// its command line (--model can come anywhere; put -- before a first message that starts with
// -), checks that it can write <out.jsonl>, whose folder must exist, refuses a first message
// that looks private (sanitize.mjs's scan, plus this machine's home folder and name) and checks
// that Claude Code's transcript folder exists ($CLAUDE_CONFIG_DIR/projects or
// ~/.claude/projects). The call pre-approves the Skill tool,
// and Read only inside the skill's folder. The raw transcript holds local paths, request
// metadata and account details, so sanitize.mjs keeps only the user and assistant messages,
// rewrites the plugin, working and home folders and the session ID, and refuses to write the
// file if the result still looks private. Read the file before you commit it anyway. Later,
// scripts/build.mjs keeps the skill text and the reference files inside it up to date.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { tmpdir, homedir, hostname } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { sanitize, scanText, machinePatterns, publicText } from './sanitize.mjs';
import { isEntryPoint } from '../build.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A Read rule for the skill's folder. In Claude Code's permission rules "//" starts an
// absolute path, and a Windows path is matched in POSIX form: C:\dev\repo becomes /c/dev/repo.
// Exported for its test, which runs on every platform.
export const skillReadRule = (dir) => `Read(/${dir.replace(/^([A-Za-z]):[\\/]/, (_, d) => `/${d.toLowerCase()}/`).replaceAll('\\', '/')}/skills/prompt-engine/**)`;

const USAGE = 'usage: record-history.mjs <out.jsonl> "<first user message>" [--model <id>]';

// Why the recording couldn't be written to out, or null when it can. Checked before the billed
// call, so that a missing folder doesn't lose a recording that was paid for.
function cannotWrite(out) {
  const file = resolve(out);
  try {
    if (!statSync(dirname(file)).isDirectory()) return 'its folder is a file';
    if (existsSync(file) && statSync(file).isDirectory()) return 'it is a folder';
    accessSync(existsSync(file) ? file : dirname(file), constants.W_OK);
    return null;
  } catch (e) {
    return e.code === 'ENOENT' ? 'its folder doesn\'t exist' : e.message;
  }
}

function main() {
  // Options anywhere, and exactly two arguments besides them: read by position, a flag before
  // them became the output file and the model name the first message.
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: { model: { type: 'string', default: 'claude-sonnet-5-5' } }, allowPositionals: true });
  } catch (e) {
    console.error(`${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const { values: { model }, positionals } = parsed;
  if (positionals.length !== 2 || positionals.includes('') || model === '') {
    console.error(USAGE);
    process.exit(2);
  }
  const [out, firstMessage] = positionals;
  const unwritable = cannotWrite(out);
  if (unwritable) {
    console.error(`cannot write ${out} (${unwritable}), so nothing was sent`);
    process.exit(1);
  }
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
  if (run.error) {
    console.error(run.error.code === 'ENOENT' ? 'could not start claude: it isn\'t on PATH, so nothing was sent' : `claude failed: ${run.error.message}`);
    process.exit(1);
  }
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout || `claude exited with ${run.signal ?? `code ${run.status}`}`);
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

// Run only as the entry point: importing this file must never start a billed recording, not even
// under node -e with this file's path as the first argument after the code (isEntryPoint in
// build.mjs).
if (isEntryPoint({ isMain: import.meta.main, execArgv: process.execArgv, argv1: process.argv[1], self: fileURLToPath(import.meta.url) })) main();
