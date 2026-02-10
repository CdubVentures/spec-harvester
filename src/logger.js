import { nowIso } from './utils/common.js';

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const token = String(value).trim().toLowerCase();
  return token === '1' || token === 'true' || token === 'yes' || token === 'on';
}

export class EventLogger {
  constructor(options = {}) {
    this.events = [];
    this.echoStdout = options.echoStdout ?? parseBool(process.env.LOG_STDOUT, false);
  }

  push(level, event, data = {}) {
    const row = {
      ts: nowIso(),
      level,
      event,
      ...data
    };
    this.events.push(row);
    if (this.echoStdout) {
      process.stderr.write(`${JSON.stringify(row)}\n`);
    }
  }

  info(event, data = {}) {
    this.push('info', event, data);
  }

  warn(event, data = {}) {
    this.push('warn', event, data);
  }

  error(event, data = {}) {
    this.push('error', event, data);
  }
}
