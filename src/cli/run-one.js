#!/usr/bin/env node

process.argv.splice(2, 0, 'run-one');
await import('./spec.js');
