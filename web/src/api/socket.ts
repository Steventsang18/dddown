import { currentToken } from './client';

type MessageHandler = (data: any) => void;

export class SocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onMessage: MessageHandler;
  private onOpen: (() => void) | null;
  private reconnectDelay = 1000;

  constructor(onMessage: MessageHandler, onOpen?: () => void) {
    this.onMessage = onMessage;
    this.onOpen = onOpen ?? null;
    this.url = this.buildUrl();
  }

  private buildUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws?token=${currentToken()}`;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[ws] connected');
        this.reconnectDelay = 1000;
        // 连接（重连）期间丢失的 file_changed 广播无法补发，拉取比对一次
        this.onOpen?.();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.onMessage(data);
        } catch {
          console.warn('[ws] invalid message:', event.data);
        }
      };

      this.ws.onclose = () => {
        console.log('[ws] disconnected');
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[ws] error:', err);
        this.ws?.close();
      };
    } catch (err) {
      console.error('[ws] connection failed:', err);
      this.scheduleReconnect();
    }
  }

  /** 发送成功返回 true；连接不可用返回 false，由调用方降级处理 */
  send(msg: Record<string, unknown>): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  sendSave(path: string, content: string, baseHash: string): boolean {
    return this.send({ type: 'save', path, content, base_hash: baseHash });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log(`[ws] reconnecting (delay: ${this.reconnectDelay}ms)...`);
      this.url = this.buildUrl();
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 10000);
    }, this.reconnectDelay);
  }
}
