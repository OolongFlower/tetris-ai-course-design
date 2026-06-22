export class AiSocketClient {
  constructor(url = "ws://127.0.0.1:8765") {
    this.url = url;
    this.socket = null;
    this.seq = 0;
    this.pending = new Map();
    this.status = "closed";
    this.onStatus = () => {};
  }

  connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.setStatus("connecting");
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("open", () => this.setStatus("open"));
    this.socket.addEventListener("close", () => {
      this.setStatus("closed");
      this.rejectAll(new Error("WebSocket closed"));
    });
    this.socket.addEventListener("error", () => this.setStatus("error"));
    this.socket.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  disconnect() {
    if (this.socket) this.socket.close();
    this.socket = null;
    this.setStatus("closed");
  }

  setStatus(status) {
    this.status = status;
    this.onStatus(status);
  }

  isOpen() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  requestMove(state, timeoutMs = 450) {
    if (!this.isOpen()) {
      return Promise.reject(new Error("WebSocket is not connected"));
    }
    const seq = ++this.seq;
    const payload = { ...state, type: "state", seq };
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error("AI response timeout"));
      }, timeoutMs);
      this.pending.set(seq, { resolve, reject, timer });
      this.socket.send(JSON.stringify(payload));
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const pending = this.pending.get(message.seq);
    if (!pending) return;
    window.clearTimeout(pending.timer);
    this.pending.delete(message.seq);
    pending.resolve(message);
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
