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
    this.storage = options.storage || null;
    this.runtimeEventsKey = String(options.runtimeEventsKey || '_runtime/events.jsonl').trim();
    this.baseContext = {
      ...(options.context || {})
    };
    this.writeQueue = Promise.resolve();
  }

  setContext(context = {}) {
    this.baseContext = {
      ...this.baseContext,
      ...context
    };
  }

  push(level, event, data = {}) {
    const row = {
      ts: nowIso(),
      level,
      event,
      ...this.baseContext,
      ...data
    };
    this.events.push(row);
    if (this.echoStdout) {
      process.stderr.write(`${JSON.stringify(row)}\n`);
    }
    if (this.storage && typeof this.storage.appendText === 'function') {
      const line = `${JSON.stringify(row)}\n`;
      this.writeQueue = this.writeQueue
        .then(() => this.storage.appendText(
          this.runtimeEventsKey,
          line,
          { contentType: 'application/x-ndjson' }
        ))
        .catch((error) => {
          process.stderr.write(
            `[spec-harvester] runtime_event_write_failed key=${this.runtimeEventsKey} message=${error.message}\n`
          );
        });
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

  async flush() {
    await this.writeQueue;
  }
}
