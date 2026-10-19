// Lightweight terminal: streams stdout/stderr, ANSI colors, \r carriage returns, images.
const MAX_LINES = 4000;
const ANSI_FG = {
  30: "#4b5563", 31: "#f87171", 32: "#4ade80", 33: "#facc15", 34: "#60a5fa", 35: "#c084fc", 36: "#22d3ee", 37: "#e5e7eb",
  90: "#9ca3af", 91: "#fca5a5", 92: "#86efac", 93: "#fde047", 94: "#93c5fd", 95: "#d8b4fe", 96: "#67e8f9", 97: "#ffffff",
};

export class Terminal {
  constructor(el) {
    this.el = el;
    this.line = null; // current line element
    this.lineCls = "";
    this.style = {};
    this.pending = [];
    this.scheduled = false;
    this.stick = true;
    el.addEventListener("scroll", () => {
      this.stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    });
  }

  clear() {
    this.el.textContent = "";
    this.line = null;
    this.style = {};
    this.pending = [];
  }

  // Queue text; rendered once per animation frame so huge outputs stay smooth.
  write(text, cls = "") {
    this.pending.push([text, cls]);
    if (!this.scheduled) {
      this.scheduled = true;
      requestAnimationFrame(() => this.render());
    }
  }

  writeln(text, cls = "") {
    this.write(text + "\n", cls);
  }

  ensureLineEnd() {
    if (this.line && this.line.textContent.length) this.newLine("");
  }

  image(b64) {
    this.flushNow();
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    img.alt = "plot";
    this.el.appendChild(img);
    this.line = null;
    this.scroll();
  }

  flushNow() {
    if (this.pending.length) this.render();
  }

  newLine(cls) {
    const d = document.createElement("div");
    d.className = "l" + (cls ? " " + cls : "");
    this.el.appendChild(d);
    this.line = d;
    this.lineCls = cls;
    return d;
  }

  appendSpan(text, cls) {
    if (!text) return;
    if (!this.line || this.lineCls !== cls) {
      if (!this.line) this.newLine(cls);
    }
    const st = this.style;
    if (st.color || st.bold || cls) {
      const s = document.createElement("span");
      if (cls) s.className = cls;
      if (st.color) s.style.color = st.color;
      if (st.bold) s.style.fontWeight = "700";
      s.textContent = text;
      this.line.appendChild(s);
    } else {
      this.line.appendChild(document.createTextNode(text));
    }
  }

  render() {
    this.scheduled = false;
    const items = this.pending;
    this.pending = [];
    for (const [text, cls] of items) {
      // Split on ANSI escapes, newlines, carriage returns
      const re = /\x1b\[([0-9;]*)m|\x1b\[[0-9;]*[A-Za-z]|\r\n|\n|\r/g;
      let last = 0, m;
      while ((m = re.exec(text))) {
        this.appendSpan(text.slice(last, m.index), cls);
        const tok = m[0];
        if (tok === "\n" || tok === "\r\n") this.newLine("");
        else if (tok === "\r") {
          if (this.line) this.line.textContent = "";
        } else if (m[1] !== undefined) this.sgr(m[1]);
        last = re.lastIndex;
      }
      this.appendSpan(text.slice(last), cls);
    }
    // Trim old lines
    const extra = this.el.childElementCount - MAX_LINES;
    for (let i = 0; i < extra; i++) this.el.firstElementChild.remove();
    this.scroll();
  }

  sgr(codes) {
    const list = codes === "" ? [0] : codes.split(";").map(Number);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c === 0) this.style = {};
      else if (c === 1) this.style.bold = true;
      else if (c === 22) this.style.bold = false;
      else if (c === 39) this.style.color = null;
      else if (ANSI_FG[c]) this.style.color = ANSI_FG[c];
      else if (c === 38 && list[i + 1] === 2) {
        this.style.color = `rgb(${list[i + 2]},${list[i + 3]},${list[i + 4]})`;
        i += 4;
      } else if (c === 38 && list[i + 1] === 5) i += 2;
    }
  }

  scroll() {
    if (this.stick) this.el.scrollTop = this.el.scrollHeight;
  }

  forceScroll() {
    this.stick = true;
    this.scroll();
  }
}
