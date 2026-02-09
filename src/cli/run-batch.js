#!/usr/bin/env node

process.argv.splice(2, 0, 'run-batch');
await import('./spec.js');
