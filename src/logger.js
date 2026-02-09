import { nowIso } from './utils/common.js';

export class EventLogger {
  constructor() {
    this.events = [];
  }

  push(level, event, data = {}) {
    this.events.push({
      ts: nowIso(),
      level,
      event,
      ...data
    });
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
