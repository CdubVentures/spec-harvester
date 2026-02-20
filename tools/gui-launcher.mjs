#!/usr/bin/env node
/**
 * SpecFactory GUI Launcher - entry point for SpecFactory.exe.
 *
 * Supports auto-rebuild on startup when source files are newer than the EXE:
 * the launcher starts a background rebuild helper, exits, and relaunches the
 * rebuilt EXE when done.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import net from 'node:net';
import { execSync, spawn } from 'node:child_process';

const IS_WINDOWS = process.platform === 'win32';
const AUTO_REBUILD_SKIP_FLAG = '--skip-autorebuild';
const DEFAULT_PORT = 8788;

const WATCHED_DIRECTORIES = [
  'src',
  path.join('tools', 'gui-react', 'src')
];

const WATCHED_FILES = [
  'package.json',
  'package-lock.json',
  path.join('tools', 'gui-launcher.mjs'),
  path.join('tools', 'build-exe.mjs'),
  path.join('tools', 'gui-react', 'package.json'),
  path.join('tools', 'gui-react', 'package-lock.json'),
  path.join('tools', 'gui-react', 'index.html'),
  path.join('tools', 'gui-react', 'vite.config.ts'),
  path.join('tools', 'gui-react', 'postcss.config.js'),
  path.join('tools', 'gui-react', 'tailwind.config.js'),
  path.join('tools', 'gui-react', 'tailwind.config.cjs')
];

const IGNORE_DIR_NAMES = new Set([
  '.git',
  '.claude',
  '.specfactory_tmp',
  'node_modules',
  'dist',
  'gui-dist',
  'out',
  'fixtures',
  'debug',
  'implementation'
]);

const WATCHED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.json',
  '.css',
  '.html'
]);

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseEnvBool(name, fallback = true) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const token = String(raw).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

function hasCommand(command) {
  try {
    if (IS_WINDOWS) {
      execSync(`where ${command}`, { stdio: 'ignore' });
    } else {
      execSync(`which ${command}`, { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

function safeMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs || 0;
  } catch {
    return 0;
  }
}

function shouldWatchFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return WATCHED_EXTENSIONS.has(ext);
}

function walkNewestMtime(startPath) {
  const absoluteStart = path.resolve(startPath);
  if (!fs.existsSync(absoluteStart)) {
    return 0;
  }

  let newest = 0;
  const stack = [absoluteStart];

  while (stack.length > 0) {
    const current = stack.pop();
    let stat;

    try {
      stat = fs.lstatSync(current);
    } catch {
      continue;
    }

    if (stat.isSymbolicLink()) {
      continue;
    }

    if (stat.isFile()) {
      if (shouldWatchFile(current) && stat.mtimeMs > newest) {
        newest = stat.mtimeMs;
      }
      continue;
    }

    if (!stat.isDirectory()) {
      continue;
    }

    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory() && IGNORE_DIR_NAMES.has(entry.name)) {
        continue;
      }
      stack.push(path.join(current, entry.name));
    }
  }

  return newest;
}

function computeNewestSourceMtime(root) {
  let newest = 0;

  for (const relativeDir of WATCHED_DIRECTORIES) {
    const dirPath = path.join(root, relativeDir);
    const mtime = walkNewestMtime(dirPath);
    if (mtime > newest) {
      newest = mtime;
    }
  }

  for (const relativeFile of WATCHED_FILES) {
    const filePath = path.join(root, relativeFile);
    const mtime = safeMtimeMs(filePath);
    if (mtime > newest) {
      newest = mtime;
    }
  }

  return newest;
}

function writeAutoRebuildHelper(root) {
  const distDir = path.join(root, 'tools', 'dist');
  fs.mkdirSync(distDir, { recursive: true });

  const helperPath = path.join(distDir, 'auto-rebuild-specfactory.ps1');
  const helperScript = [
    "param(",
    "  [int]$ParentPid,",
    "  [string]$RootDir,",
    "  [string]$ExePath",
    ")",
    "$ErrorActionPreference = 'Stop'",
    "$logPath = Join-Path $RootDir 'tools\\dist\\auto-rebuild.log'",
    "\"[$(Get-Date -Format o)] Auto rebuild requested.\" | Out-File -FilePath $logPath -Encoding utf8",
    "while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }",
    "Set-Location -LiteralPath $RootDir",
    "\"[$(Get-Date -Format o)] Running node tools/build-exe.mjs\" | Add-Content -Path $logPath",
    "& node tools/build-exe.mjs *>> $logPath",
    "if ($LASTEXITCODE -ne 0) {",
    "  \"[$(Get-Date -Format o)] Build failed with exit code $LASTEXITCODE\" | Add-Content -Path $logPath",
    "  try { Start-Process -FilePath 'notepad.exe' -ArgumentList @($logPath) } catch { }",
    "  exit $LASTEXITCODE",
    "}",
    "\"[$(Get-Date -Format o)] Build succeeded. Relaunching SpecFactory.exe\" | Add-Content -Path $logPath",
    "Start-Process -FilePath $ExePath -ArgumentList @('--skip-autorebuild')"
  ].join('\r\n');

  fs.writeFileSync(helperPath, helperScript, 'utf8');
  return helperPath;
}

function startAutoRebuildProcess({ root, exePath, parentPid }) {
  const helperPath = writeAutoRebuildHelper(root);
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershellPath = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const executable = fs.existsSync(powershellPath) ? powershellPath : 'powershell.exe';

  const child = spawn(
    executable,
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      helperPath,
      '-ParentPid',
      String(parentPid),
      '-RootDir',
      root,
      '-ExePath',
      exePath
    ],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore'
    }
  );

  child.unref();
}

function maybeStartAutoRebuild({ root, exePath }) {
  if (!IS_WINDOWS) {
    return false;
  }
  if (!hasFlag(AUTO_REBUILD_SKIP_FLAG)) {
    if (!parseEnvBool('SPECFACTORY_AUTO_REBUILD', true)) {
      return false;
    }
  }
  if (hasFlag(AUTO_REBUILD_SKIP_FLAG)) {
    return false;
  }

  const buildScriptPath = path.join(root, 'tools', 'build-exe.mjs');
  if (!fs.existsSync(buildScriptPath)) {
    return false;
  }

  if (!hasCommand('node') || !hasCommand('npm') || !hasCommand('npx')) {
    return false;
  }

  const exeMtime = safeMtimeMs(exePath);
  if (!exeMtime) {
    return false;
  }

  const sourceMtime = computeNewestSourceMtime(root);
  if (!sourceMtime) {
    return false;
  }

  if (sourceMtime <= (exeMtime + 1000)) {
    return false;
  }

  try {
    startAutoRebuildProcess({
      root,
      exePath,
      parentPid: process.pid
    });
  } catch (error) {
    console.error('  Auto rebuild start failed:', error?.message || error);
    return false;
  }

  console.log('');
  console.log('  Source changes detected (newer than SpecFactory.exe).');
  console.log(`  Source timestamp: ${new Date(sourceMtime).toISOString()}`);
  console.log(`  EXE timestamp:    ${new Date(exeMtime).toISOString()}`);
  console.log('  Starting auto rebuild in background...');
  console.log('  SpecFactory will relaunch automatically when rebuild completes.');
  console.log('');
  return true;
}

function getPortFromArgv(defaultPort = DEFAULT_PORT) {
  const idx = process.argv.indexOf('--port');
  if (idx < 0 || idx + 1 >= process.argv.length) {
    return defaultPort;
  }
  const parsed = Number.parseInt(String(process.argv[idx + 1] || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort;
}

function waitForEnter() {
  return new Promise((resolve) => {
    console.log('');
    console.log('  Press Enter to exit...');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.once('line', () => {
      rl.close();
      resolve();
    });
  });
}

process.on('uncaughtException', async (error) => {
  console.error('');
  console.error('  FATAL ERROR:', error?.message || error);
  if (error?.stack) {
    console.error(error.stack);
  }
  await waitForEnter();
  process.exit(1);
});

process.on('unhandledRejection', async (error) => {
  console.error('');
  console.error('  FATAL ERROR (unhandled rejection):', error?.message || error);
  if (error?.stack) {
    console.error(error.stack);
  }
  await waitForEnter();
  process.exit(1);
});

async function killPortOccupant(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.log(`  Port ${port} is in use - killing existing process...`);
        try {
          const output = execSync(
            `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
            { encoding: 'utf8', timeout: 5000 }
          ).trim();
          const lines = output.split('\n').filter(Boolean);
          const pids = new Set();
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = Number.parseInt(parts[parts.length - 1], 10);
            if (pid && pid !== process.pid) {
              pids.add(pid);
            }
          }
          for (const pid of pids) {
            try {
              execSync(`taskkill /PID ${pid} /F`, { timeout: 5000 });
              console.log(`  Killed PID ${pid}`);
            } catch {
              // ignore
            }
          }
          setTimeout(resolve, 1000);
        } catch {
          try {
            execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { timeout: 5000 });
          } catch {
            // ignore
          }
          setTimeout(resolve, 1000);
        }
      } else {
        resolve();
      }
    });
    tester.once('listening', () => {
      tester.close(resolve);
    });
    tester.listen(port, '0.0.0.0');
  });
}

const isPkg = typeof process.pkg !== 'undefined';
if (isPkg) {
  const exeDir = path.dirname(process.execPath);
  process.chdir(exeDir);
  process.env.__GUI_DIST_ROOT = path.join(exeDir, 'gui-dist');

  // Patch native module resolution: pkg's snapshot can't include .node addons,
  // so we redirect require('better-sqlite3') to load from the real filesystem.
  const Module = require('module');
  const origResolveFilename = Module._resolveFilename;
  const nativeModules = ['better-sqlite3'];
  Module._resolveFilename = function(request, parent, isMain, options) {
    if (nativeModules.includes(request)) {
      // Resolve from the exe directory's node_modules instead of the snapshot
      const realPath = path.join(exeDir, 'node_modules', request);
      return origResolveFilename.call(this, realPath, parent, isMain, options);
    }
    return origResolveFilename.call(this, request, parent, isMain, options);
  };

  // Auto-rebuild disabled during active development — run SpecFactoryBuild.bat manually
  // if (maybeStartAutoRebuild({ root: exeDir, exePath: process.execPath })) {
  //   process.exit(0);
  // }
}

process.argv = process.argv.filter((arg) => arg !== AUTO_REBUILD_SKIP_FLAG);

const inject = ['--local', '--port', String(DEFAULT_PORT), '--open'];
for (const flag of inject) {
  if (!process.argv.includes(flag)) {
    process.argv.push(flag);
  }
}

console.log('');
console.log('  +======================================+');
console.log('  |       Spec Factory -- GUI Server      |');
console.log('  +======================================+');
console.log('');
console.log(`  Mode: ${isPkg ? 'Standalone EXE' : 'Development'}`);
console.log(`  CWD:  ${process.cwd()}`);
console.log('');

(async () => {
  try {
    const targetPort = getPortFromArgv(DEFAULT_PORT);
    await killPortOccupant(targetPort);
    await import('../src/api/guiServer.js');
  } catch (error) {
    console.error('');
    console.error('  Failed to start server:', error?.message || error);
    if (error?.stack) {
      console.error(error.stack);
    }
    await waitForEnter();
    process.exit(1);
  }
})();