// Placeholder Socket service - replace with actual server implementation
export interface SocketMessage {
  action: string;
  data: any;
}

class PlaceholderSocketService {
  private messageHandlers = new Map<string, (data: any) => void>();
  private isConnected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(private restService: any) {}

  async connect(): Promise<void> {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 500));
    this.isConnected = true;
    console.log("Placeholder WebSocket connected");
  }

  disconnect(): void {
    this.isConnected = false;
    console.log("Placeholder WebSocket disconnected");
  }

  onMessage(action: string, handler: (data: any) => void): void {
    this.messageHandlers.set(action, handler);
    console.log(`Placeholder: Registered handler for ${action}`);
  }

  removeMessageHandler(action: string): void {
    this.messageHandlers.delete(action);
    console.log(`Placeholder: Removed handler for ${action}`);
  }

  sendMessage(action: string, data: any): void {
    if (!this.isConnected) {
      console.warn("Placeholder: Socket not connected, message not sent");
      return;
    }
    console.log(`Placeholder: Sending message ${action}`, data);
  }

  // Simulate receiving messages (for testing purposes)
  simulateMessage(action: string, data: any): void {
    const handler = this.messageHandlers.get(action);
    if (handler) {
      handler({ action, data });
    }
  }

  // Simulate connection events
  simulateConnection(): void {
    this.isConnected = true;
  }

  simulateDisconnection(): void {
    this.isConnected = false;
  }
}

export default PlaceholderSocketService;
