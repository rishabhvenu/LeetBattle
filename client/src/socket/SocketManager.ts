import RestHandler from "@/rest/RestHandler";

type MessageHandler = (message: any) => void;
type QueuedMessage = { action: string; payload: any };

class SocketManager {
  private socket: WebSocket | null = null;
  private url: string;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private reconnectAttempts: number = 0;
  private reconnectInterval: number = 3000;
  private restHandler: RestHandler;
  private messageQueue: QueuedMessage[] = [];
  private isConnecting: boolean = false;

  constructor(restHandler: RestHandler) {
    this.url = `${process.env.NEXT_PUBLIC_WEBSOCKET_URL}`;
    this.restHandler = restHandler;
  }

  async connect(): Promise<void> {
    if (this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      const cookie = await this.restHandler.handshake();
      const wsUrl = `${this.url}?cookie=${encodeURIComponent(cookie)}`;

      return new Promise((resolve, reject) => {
        this.socket = new WebSocket(wsUrl);

        this.socket.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          this.isConnecting = false;
          this.processQueue();
          resolve();
        };

        this.socket.onmessage = (event) => {
          const data = JSON.parse(event.data);
          const handler = this.messageHandlers.get(data.action);
          if (handler) {
            handler(data);
          } else {
            console.warn(`No handler for action: ${data.action}`);
          }
        };

        this.socket.onclose = () => {
          console.log("WebSocket disconnected");
          this.isConnecting = false;
          this.reconnect();
        };

        this.socket.onerror = (error) => {
          console.error("WebSocket error:", error);
          this.isConnecting = false;
          reject(error);
        };
      });
    } catch (error) {
      console.error("Connection failed:", error);
      this.isConnecting = false;
      throw error;
    }
  }

  private async reconnect() {
    this.reconnectAttempts++;
    console.log(`Attempting to reconnect...`);
    setTimeout(() => this.connect(), this.reconnectInterval);
  }

  async sendMessage(action: string, payload: any): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.sendMessage_(action, payload);
    } else {
      console.log("WebSocket is not connected. Queueing message.");
      this.messageQueue.push({ action, payload });
    }
  }

  onMessage(action: string, handler: MessageHandler): void {
    this.messageHandlers.set(action, handler);
  }

  removeMessageHandler(action: string): void {
    this.messageHandlers.delete(action);
  }

  private sendMessage_(action: string, payload: any): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ action, ...payload });
      this.socket.send(message);
    } else {
      console.error("WebSocket is not connected");
    }
  }

  private processQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        this.sendMessage_(message.action, message.payload);
      }
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
    }
  }
}

export default SocketManager;
