// Talks to the Python worker. Stop = terminate the worker and boot a fresh one.
export class PyClient {
  constructor(handlers) {
    this.h = handlers; // { onStatus, onReady, onStdout, onStderr, onInfo, onInputRequest, onImage, onDone, onReplDone, onInstallDone, onFatal }
    this.ready = false;
    this.info = null;
    this.reqId = 0;
    this.waiters = new Map();
    this.start();
  }

  start() {
    this.ready = false;
    this.worker = new Worker(new URL("./py-worker.mjs", document.baseURI), { type: "module" });
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.h.onFatal?.(e.message || "Python worker failed to start");
  }

  restart() {
    try {
      this.worker.terminate();
    } catch (_) {}
    for (const [, w] of this.waiters) w([]);
    this.waiters.clear();
    this.start();
  }

  onMessage(m) {
    const h = this.h;
    switch (m.type) {
      case "status": return h.onStatus?.(m.text);
      case "ready":
        this.ready = true;
        this.info = m;
        return h.onReady?.(m);
      case "stdout": return h.onStdout?.(m.text);
      case "stderr": return h.onStderr?.(m.text);
      case "info": return h.onInfo?.(m.text, m.error);
      case "input-request": return h.onInputRequest?.(m.prompt);
      case "image": return h.onImage?.(m.data);
      case "done": return h.onDone?.(m);
      case "repl-done": return h.onReplDone?.();
      case "install-done": return h.onInstallDone?.(m);
      case "fatal": return h.onFatal?.(m.text);
      case "check-result":
      case "complete-result": {
        const w = this.waiters.get(m.id);
        if (w) {
          this.waiters.delete(m.id);
          w(m);
        }
        return;
      }
    }
  }

  post(msg) {
    this.worker.postMessage(msg);
  }

  run(files, entry, stdin) {
    this.post({ type: "run", files, entry, stdin });
  }
  repl(code) {
    this.post({ type: "repl", code });
  }
  sendInput(value) {
    this.post({ type: "input", value });
  }
  install(name) {
    this.post({ type: "install", name });
  }

  ask(type, payload, timeout = 1200) {
    if (!this.ready) return Promise.resolve({ skip: true, items: [] });
    const id = ++this.reqId;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters.delete(id);
        resolve({ skip: true, items: [] });
      }, timeout);
      this.waiters.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.post({ type, id, ...payload });
    });
  }
}
