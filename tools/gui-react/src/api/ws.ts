type Channel = 'events' | 'queue' | 'process' | 'data-change' | 'test-import-progress' | 'indexlab-event';
type MessageHandler = (channel: Channel, data: unknown) => void;

interface WsManagerOptions {
  url?: string;
  reconnectMs?: number;
  maxReconnectMs?: number;
}

export class WsManager {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectMs: number;
  private maxReconnectMs: number;
  private currentDelay: number;
  private handlers = new Set<MessageHandler>();
  private subscriptions: { channels: Channel[]; category?: string; productId?: string } | null = null;
  private closed = false;

  constructor(opts: WsManagerOptions = {}) {
    const loc = window.location;
    this.url = opts.url || `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host}/ws`;
    this.reconnectMs = opts.reconnectMs || 1000;
    this.maxReconnectMs = opts.maxReconnectMs || 30000;
    this.currentDelay = this.reconnectMs;
  }

  connect() {
    if (this.ws) return;
    this.closed = false;
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.currentDelay = this.reconnectMs;
      if (this.subscriptions) {
        this.ws?.send(JSON.stringify({ subscribe: this.subscriptions.channels, ...this.subscriptions }));
      }
    };

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        const channel = msg.channel as Channel;
        this.handlers.forEach((h) => h(channel, msg.data));
      } catch { /* ignore bad frames */ }
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (!this.closed) {
        setTimeout(() => this.connect(), this.currentDelay);
        this.currentDelay = Math.min(this.currentDelay * 1.5, this.maxReconnectMs);
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  subscribe(channels: Channel[], category?: string, productId?: string) {
    this.subscriptions = { channels, category, productId };
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ subscribe: channels, category, productId }));
    }
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  close() {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }
}

export const wsManager = new WsManager();
