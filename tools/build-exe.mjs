#!/usr/bin/env node
/**
 * Build SpecFactory.exe — three-step pipeline:
 *   1. Build React GUI → tools/gui-react/dist/
 *   2. esbuild bundle  → tools/dist/launcher.cjs
 *   3. pkg compile      → SpecFactory.exe
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function run(cmd, opts = {}) {
  console.log(`\n  > ${cmd}\n`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...opts });
}

// ── Step 1: Build React GUI ──────────────────────────────────────────
console.log('\n===  Step 1/3 -- Building React GUI  ===');
const guiDir = path.join(ROOT, 'tools', 'gui-react');
if (!fs.existsSync(path.join(guiDir, 'node_modules'))) {
  run('npm install', { cwd: guiDir });
}
run('npm run build', { cwd: guiDir });

// Verify dist was produced
const distIndex = path.join(guiDir, 'dist', 'index.html');
if (!fs.existsSync(distIndex)) {
  console.error('  ERROR: React build did not produce dist/index.html');
  process.exit(1);
}
console.log('  React GUI built successfully.');

// ── Step 2: esbuild bundle ───────────────────────────────────────────
console.log('\n===  Step 2/3 -- esbuild bundle  ===');
const outDir = path.join(ROOT, 'tools', 'dist');
fs.mkdirSync(outDir, { recursive: true });

const esbuildArgs = [
  'npx esbuild tools/gui-launcher.mjs',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node22',
  '--outfile=tools/dist/launcher.cjs',
  // Native / optional modules NOT in the server dependency chain — mark external
  '--external:better-sqlite3',
  '--external:playwright',
  '--external:pdf-parse',
  '--external:@aws-sdk',
  // Node builtins
  '--external:node:fs',
  '--external:node:fs/promises',
  '--external:node:path',
  '--external:node:http',
  '--external:node:https',
  '--external:node:net',
  '--external:node:tls',
  '--external:node:os',
  '--external:node:crypto',
  '--external:node:stream',
  '--external:node:zlib',
  '--external:node:events',
  '--external:node:url',
  '--external:node:util',
  '--external:node:child_process',
  '--external:node:worker_threads',
  '--external:node:assert',
  '--external:node:buffer',
  '--external:node:string_decoder',
  '--external:node:querystring',
  '--external:fs',
  '--external:path',
  '--external:http',
  '--external:https',
  '--external:net',
  '--external:tls',
  '--external:os',
  '--external:crypto',
  '--external:stream',
  '--external:zlib',
  '--external:events',
  '--external:url',
  '--external:util',
  '--external:child_process',
  '--external:worker_threads',
  '--external:assert',
  '--external:buffer',
  '--external:string_decoder',
  '--external:querystring',
];

run(esbuildArgs.join(' '));

const bundlePath = path.join(outDir, 'launcher.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error('  ERROR: esbuild did not produce tools/dist/launcher.cjs');
  process.exit(1);
}
const bundleSize = (fs.statSync(bundlePath).size / 1024 / 1024).toFixed(1);
console.log(`  Bundle produced: tools/dist/launcher.cjs (${bundleSize} MB)`);

// ── Step 3: pkg compile ──────────────────────────────────────────────
console.log('\n===  Step 3/3 -- pkg compile -> SpecFactory.exe  ===');
const exePath = path.join(ROOT, 'SpecFactory.exe');

// Kill any running SpecFactory.exe so we can overwrite it
if (fs.existsSync(exePath)) {
  console.log('  Checking for running SpecFactory.exe...');
  try {
    // Find and kill SpecFactory.exe processes (but not this build process)
    const myPid = process.pid;
    const output = execSync('tasklist /FI "IMAGENAME eq SpecFactory.exe" /FO CSV /NH', {
      encoding: 'utf8', timeout: 5000
    }).trim();
    const lines = output.split('\n').filter(l => l.includes('SpecFactory.exe'));
    for (const line of lines) {
      const match = line.match(/"SpecFactory\.exe","(\d+)"/i);
      if (match) {
        const pid = parseInt(match[1], 10);
        if (pid && pid !== myPid) {
          console.log(`  Stopping SpecFactory.exe (PID ${pid})...`);
          try { execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 }); } catch { /* ignore */ }
        }
      }
    }
    // Wait a moment for the process and file handles to release
    const waitMs = lines.length > 0 ? 2000 : 0;
    if (waitMs) {
      console.log(`  Waiting ${waitMs / 1000}s for process to release...`);
      execSync(`ping -n ${Math.ceil(waitMs / 1000) + 1} 127.0.0.1 >nul`, { shell: true, timeout: 10000 });
    }
  } catch (err) {
    console.log(`  (process check skipped: ${err.message})`);
  }

  // Try to delete the old exe to confirm the file handle is released
  let retries = 3;
  while (retries > 0) {
    try {
      fs.unlinkSync(exePath);
      console.log('  Old SpecFactory.exe removed.');
      break;
    } catch (unlinkErr) {
      retries--;
      if (retries === 0) {
        console.error('');
        console.error('  ERROR: Cannot overwrite SpecFactory.exe - it may still be running.');
        console.error('  Close SpecFactory.exe and try again.');
        console.error(`  (${unlinkErr.message})`);
        process.exit(1);
      }
      console.log(`  File still locked, retrying in 2s... (${retries} attempts left)`);
      execSync('ping -n 3 127.0.0.1 >nul', { shell: true, timeout: 10000 });
    }
  }
}

run('npx @yao-pkg/pkg tools/dist/launcher.cjs --targets node22-win-x64 --output SpecFactory.exe');

if (!fs.existsSync(exePath)) {
  console.error('  ERROR: pkg did not produce SpecFactory.exe');
  process.exit(1);
}

// ── Step 4: Copy React dist next to exe ──────────────────────────────
console.log('\n===  Step 4 -- Copying GUI assets  ===');
const guiDistTarget = path.join(ROOT, 'gui-dist');
// Clean old gui-dist to prevent stale assets from accumulating
if (fs.existsSync(guiDistTarget)) {
  fs.rmSync(guiDistTarget, { recursive: true, force: true });
  console.log('  Cleaned old gui-dist/');
}
fs.cpSync(path.join(guiDir, 'dist'), guiDistTarget, { recursive: true });
console.log(`  Copied tools/gui-react/dist/ -> gui-dist/`);

const exeSize = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log(`\n  SpecFactory.exe built successfully (${exeSize} MB)`);
console.log(`  Location: ${exePath}`);
console.log('');
console.log('  To distribute, copy these together:');
console.log('    SpecFactory.exe');
console.log('    gui-dist/');
console.log('');
console.log('  Double-click SpecFactory.exe to start.');
console.log('');
