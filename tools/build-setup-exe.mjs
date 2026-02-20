#!/usr/bin/env node
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

function run(cmd, opts = {}) {
  console.log('');
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, shell: true, ...opts });
}

console.log('');
console.log('=== Building Launcher.exe ===');

const distDir = path.join(ROOT, 'tools', 'dist');
fs.mkdirSync(distDir, { recursive: true });

console.log('');
console.log('Step 1/2 - esbuild bundle');
run(
  [
    'npx esbuild tools/specfactory-launcher.mjs',
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--outfile=tools/dist/specfactory-launcher.cjs'
  ].join(' ')
);

const bundlePath = path.join(distDir, 'specfactory-launcher.cjs');
if (!fs.existsSync(bundlePath)) {
  console.error('Bundle file not found: tools/dist/specfactory-launcher.cjs');
  process.exit(1);
}

console.log('');
console.log('Step 2/2 - pkg compile');
const outputName = 'Launcher.exe';
try {
  run('npx @yao-pkg/pkg tools/dist/specfactory-launcher.cjs --targets node20-win-x64 --output Launcher.exe');
} catch (error) {
  console.error('');
  console.error('Launcher.exe is likely in use. Close Launcher and run build again.');
  throw error;
}

const exePath = path.join(ROOT, outputName);
if (!fs.existsSync(exePath)) {
  console.error(`Exe file not found: ${outputName}`);
  process.exit(1);
}

const exeSizeMb = (fs.statSync(exePath).size / 1024 / 1024).toFixed(1);
console.log('');
console.log(`${outputName} built successfully (${exeSizeMb} MB).`);
console.log(`Location: ${exePath}`);
