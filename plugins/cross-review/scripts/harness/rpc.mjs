export class JsonlRpc {
  constructor(stdin, stdout, { jsonrpc = false } = {}) {
    this.stdin = stdin;
    this.jsonrpc = jsonrpc;
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.closed = false;
    this.onNotification = null;
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk) => this.handleChunk(chunk));
    stdout.on("end", () => this.failAll(new Error("rpc stream ended")));
  }

  handleChunk(chunk) {
    this.buffer += chunk;
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (err) {
        this.failAll(new Error(`invalid jsonl: ${err.message}`));
        return;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(message.error.message ?? JSON.stringify(message.error))
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      this.onNotification?.(message);
    }
  }

  request(method, params = {}, timeoutMs = 120000) {
    if (this.closed) return Promise.reject(new Error("rpc closed"));
    const id = this.nextId++;
    const message = { id, method, params };
    if (this.jsonrpc) message.jsonrpc = "2.0";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`rpc timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      this.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  notify(method, params = {}) {
    if (this.closed) return;
    const message = { method, params };
    if (this.jsonrpc) message.jsonrpc = "2.0";
    this.stdin.write(`${JSON.stringify(message)}\n`);
  }

  failAll(err) {
    for (const pending of this.pending.values()) pending.reject(err);
    this.pending.clear();
  }

  close() {
    this.closed = true;
    this.failAll(new Error("rpc closed"));
  }
}

export function waitFor(predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve();
      }
    }, 20);
  });
}
