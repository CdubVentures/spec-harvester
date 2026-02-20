#!/usr/bin/env node
import path from 'node:path';
import { installDependencies } from './setup-core.mjs';

const scriptPath = path.resolve(process.argv[1] || path.join(process.cwd(), 'tools', 'setup-deps.mjs'));
const scriptDir = path.dirname(scriptPath);
const ROOT = typeof process.pkg !== 'undefined'
  ? path.dirname(process.execPath)
  : path.resolve(scriptDir, '..');

async function main() {
  process.chdir(ROOT);
  const strictServices = process.argv.includes('--strict-services');

  console.log('');
  console.log('+---------------------------------------------+');
  console.log('|        SpecFactory Dependency Setup          |');
  console.log('+---------------------------------------------+');
  console.log(`Project root: ${ROOT}`);
  if (strictServices) {
    console.log('Mode: strict services');
  }

  await installDependencies({
    root: ROOT,
    strictServices,
    onLine: (line) => {
      process.stdout.write(`${line}\n`);
    }
  });

  console.log('');
  console.log('Setup completed successfully.');
}

main().catch((error) => {
  console.error('');
  console.error('Setup failed:', error.message || error);
  process.exitCode = 1;
});
