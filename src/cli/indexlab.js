#!/usr/bin/env node

process.argv.splice(2, 0, 'indexlab');
await import('./spec.js');

