// PostToolUse hook for Edit/Write. VROS has no build step, so a syntax error
// or a stray three.js version only shows up as a blank page in the headset;
// this catches both right after the edit. Exit 2 sends the message back to
// Claude so it fixes it.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { relative } from 'node:path';

// three.js versions per page; every other page uses DEFAULT.
const DEFAULT = '0.170.0';
const PINS = { 'apps/splat/index.html': '0.180.0' }; // Spark needs r180

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const file = input.tool_input?.file_path;
if (!file || !existsSync(file)) process.exit(0);
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rel = relative(root, file).replace(/\\/g, '/');
if (rel.startsWith('..') || rel.startsWith('.claude/')) process.exit(0);

const fail = (msg) => {
  process.stderr.write(msg + '\n');
  process.exit(2);
};

if (/\.m?js$/.test(file)) {
  // Every .js here is an ES module (imported from an import-mapped page).
  const src = readFileSync(file, 'utf8');
  const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: src, encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = r.stderr.replace(/\[stdin\]/g, rel).split(/\n\s+at /)[0].trim(); // drop node's own stack
    fail(`Syntax error in ${rel}:\n${msg}`);
  }
} else if (file.endsWith('.html')) {
  const html = readFileSync(file, 'utf8');
  const want = PINS[rel] || DEFAULT;
  const found = [...html.matchAll(/three@([\d.]+)/g)].map((m) => m[1]);
  const wrong = [...new Set(found.filter((v) => v !== want))];
  if (wrong.length) {
    fail(`${rel} pins three@${wrong.join(', three@')} but this page should use three@${want} ` +
      `(see PINS in .claude/hooks/check-edit.mjs; update it there if the change is intentional).`);
  }
}
