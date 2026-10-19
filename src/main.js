import "./style.css";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "./monaco-features.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/languages/definitions/ini/register.js";
import "monaco-editor/languages/definitions/yaml/register.js";
import "monaco-editor/languages/definitions/html/register.js";
import "monaco-editor/languages/definitions/css/register.js";
import "monaco-editor/languages/definitions/javascript/register.js";
import "monaco-editor/languages/definitions/shell/register.js";
import "monaco-editor/languages/definitions/sql/register.js";
import "monaco-editor/languages/definitions/xml/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

import { ws, save, reset, norm, allFolders, createFile, createFolder, rename, remove, uniqueName, langFor } from "./workspace.js";
import { Terminal } from "./terminal.js";
import { PyClient } from "./pyclient.js";
import { setupPython, checkSyntax } from "./python-lang.js";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const $ = (s) => document.querySelector(s);
const app = $("#app");
const isWide = () => matchMedia("(min-width: 900px)").matches;

// ---------------------------------------------------------------- viewport (keyboard-safe height)
function fitViewport() {
  const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--app-h", h + "px");
  window.scrollTo(0, 0);
}
window.visualViewport?.addEventListener("resize", fitViewport);
window.addEventListener("resize", fitViewport);
fitViewport();

// ---------------------------------------------------------------- toast / dialogs / menu
let toastTimer;
function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

function dialog({ title, body = "", value = null, ok = "OK", danger = false, select = null, multiline = false }) {
  return new Promise((resolve) => {
    $("#dialog-title").textContent = title;
    $("#dialog-body").textContent = body;
    const single = $("#dialog-input");
    const area = $("#dialog-textarea");
    single.hidden = area.hidden = true;
    const input = multiline ? area : single;
    input.hidden = value === null;
    input.value = value ?? "";
    const okBtn = $("#dialog-ok");
    okBtn.textContent = ok;
    okBtn.classList.toggle("danger", danger);
    $("#dialog-backdrop").hidden = false;
    if (value !== null) {
      setTimeout(() => {
        input.focus();
        if (select) input.setSelectionRange(select[0], select[1]);
        else input.select();
      }, 50);
    }
    const done = (v) => {
      $("#dialog-backdrop").hidden = true;
      okBtn.onclick = $("#dialog-cancel").onclick = input.onkeydown = null;
      resolve(v);
    };
    okBtn.onclick = () => done(value === null ? true : multiline ? input.value : input.value.trim());
    $("#dialog-cancel").onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter" && !multiline) okBtn.click();
      if (e.key === "Escape") done(null);
    };
  });
}

function openMenu(anchor, items) {
  const menu = $("#menu");
  menu.innerHTML = "";
  for (const it of items) {
    if (it === "-") {
      menu.appendChild(Object.assign(document.createElement("div"), { className: "sep" }));
      continue;
    }
    const b = document.createElement("button");
    b.innerHTML = `<span>${it.label}</span>${it.kbd ? `<span class="kbd">${it.kbd}</span>` : ""}`;
    if (it.danger) b.className = "danger";
    b.onclick = () => {
      closeMenu();
      it.run();
    };
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = Math.min(r.right - mw, window.innerWidth - mw - 8);
  x = Math.max(8, x < 8 ? r.left : x);
  let y = r.bottom + 4;
  if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  setTimeout(() => document.addEventListener("pointerdown", outside, { capture: true }), 0);
}
function outside(e) {
  if (!$("#menu").contains(e.target)) closeMenu();
}
function closeMenu() {
  $("#menu").hidden = true;
  document.removeEventListener("pointerdown", outside, { capture: true });
}

// ---------------------------------------------------------------- Monaco
monaco.editor.defineTheme("madara-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "c084fc" },
    { token: "string", foreground: "86efac" },
    { token: "number", foreground: "fbbf24" },
    { token: "comment", foreground: "5d6889", fontStyle: "italic" },
    { token: "identifier", foreground: "d6def5" },
    { token: "type", foreground: "22d3ee" },
    { token: "delimiter", foreground: "8a96b8" },
  ],
  colors: {
    "editor.background": "#0b1020",
    "editor.foreground": "#d6def5",
    "editorLineNumber.foreground": "#3b4670",
    "editorLineNumber.activeForeground": "#22d3ee",
    "editorCursor.foreground": "#22d3ee",
    "editor.lineHighlightBackground": "#121a33",
    "editor.selectionBackground": "#22d3ee33",
    "editor.inactiveSelectionBackground": "#22d3ee1f",
    "editorIndentGuide.background1": "#1b2442",
    "editorIndentGuide.activeBackground1": "#3b4670",
    "editorWidget.background": "#141b33",
    "editorSuggestWidget.background": "#141b33",
    "editorSuggestWidget.border": "#222c4d",
    "editorSuggestWidget.selectedBackground": "#22d3ee26",
    "editorBracketMatch.border": "#22d3ee",
    "scrollbarSlider.background": "#3b467055",
  },
});

const S = ws.settings;
const touch = matchMedia("(pointer: coarse)").matches;
const editor = monaco.editor.create($("#editor"), {
  theme: S.theme,
  fontSize: S.fontSize,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Roboto Mono', ui-monospace, monospace",
  fontLigatures: true,
  tabSize: S.tabSize,
  insertSpaces: true,
  wordWrap: S.wordWrap ? "on" : "off",
  minimap: { enabled: S.minimap },
  automaticLayout: true,
  scrollBeyondLastLine: false,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  renderLineHighlight: "all",
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  padding: { top: 8, bottom: 8 },
  lineNumbersMinChars: touch ? 3 : 4,
  folding: !touch || isWide(),
  glyphMargin: false,
  stickyScroll: { enabled: true },
  suggest: { showStatusBar: false, preview: true },
  quickSuggestions: { other: true, comments: false, strings: false },
  acceptSuggestionOnEnter: "smart",
  mouseWheelZoom: true,
  contextmenu: !touch,
  fixedOverflowWidgets: true,
  unicodeHighlight: { ambiguousCharacters: false },
});

window.__pyide = { editor, monaco }; // handy for debugging via chrome://inspect

// One Monaco model per file
const models = new Map();
function modelFor(path) {
  let m = models.get(path);
  if (!m || m.isDisposed()) {
    m = monaco.editor.createModel(ws.files[path] ?? "", langFor(path), monaco.Uri.file("/" + path));
    m.onDidChangeContent(() => {
      ws.files[path] = m.getValue();
      save();
      scheduleLint();
    });
    models.set(path, m);
  }
  return m;
}
function disposeModel(path) {
  const m = models.get(path);
  if (m) m.dispose();
  models.delete(path);
}
const viewStates = new Map();

// ---------------------------------------------------------------- Python
const term = new Terminal($("#terminal"));
let stdlib = [];
let running = false;
let replBusy = false;
let waitingInput = false;
const pkgState = new Map(); // name -> "ok" | "busy" | "bad"

const py = new PyClient({
  onStatus: (t) => setPyStatus(t, "busy"),
  onReady: (info) => {
    stdlib = info.stdlib || [];
    stackSwitching = info.stackSwitching;
    setPyStatus(`Python ${info.pyVersion}`, "ready");
    $("#about-versions").textContent = `Python ${info.pyVersion} · Pyodide ${info.pyodideVersion} · live input(): ${info.stackSwitching ? "yes" : "no (old WebView)"}`;
    $("#btn-run").classList.remove("loading");
    if (!info.stackSwitching && !warnedNoSync) {
      warnedNoSync = true;
      term.writeln("[Your Android System WebView is old, so input() answers are asked before the program runs. Update 'Android System WebView' from the Play Store for live input.]", "sys");
    }
    if (pendingRun) {
      pendingRun = false;
      runActive();
    }
    restorePackages();
    scheduleLint();
  },
  onStdout: (t) => term.write(t),
  onStderr: (t) => term.write(t, "err"),
  onInfo: (t, isErr) => {
    if (isErr) term.writeln("[" + t.trim() + "]", "err sys");
    else if (/^Loading/.test(t)) term.writeln("[" + t.trim() + "]", "sys");
  },
  onInputRequest: (prompt) => {
    waitingInput = true;
    setInputMode(prompt);
  },
  onImage: (b64) => term.image(b64),
  onDone: (m) => {
    term.flushNow();
    term.ensureLineEnd();
    term.writeln(m.ok ? `[Finished in ${(m.ms / 1000).toFixed(2)}s]` : `[Finished with errors]`, m.ok ? "ok sys" : "err sys");
    if (m.files) mergeOutputFiles(m.files);
    setRunning(false);
  },
  onReplDone: () => {
    replBusy = false;
    setRunning(false);
  },
  onInstallDone: (m) => {
    pkgState.set(m.name, m.ok ? "ok" : "bad");
    if (m.ok) {
      if (!ws.packages.includes(m.name)) ws.packages.push(m.name);
      save();
      toast(`Installed ${m.name}`);
    } else {
      term.writeln(`[pip] ${m.name}: ${m.error}`, "err");
      toast(`Could not install ${m.name}`);
    }
    renderPackages();
  },
  onFatal: (t) => {
    setPyStatus("Python failed to start", "dead");
    term.writeln("Python engine error:\n" + t, "err");
    setRunning(false);
  },
});
let pendingRun = false;
let warnedNoSync = false;
let restored = false;

function restorePackages() {
  if (restored) return;
  restored = true;
  for (const p of ws.packages) {
    pkgState.set(p, "busy");
    py.install(p);
  }
  renderPackages();
}

function setPyStatus(text, state) {
  $("#st-py span").textContent = text;
  $("#st-py .dot").className = "dot " + state;
}

function setRunning(on) {
  running = on;
  $("#btn-run").hidden = on;
  $("#btn-stop").hidden = !on;
  const rs = $("#run-state");
  rs.textContent = on ? "● running" : "";
  rs.className = on ? "running" : "";
  setPyStatus(py.ready ? (on ? "Running…" : `Python ${py.info.pyVersion}`) : "Python starting…", on ? "busy" : py.ready ? "ready" : "busy");
  if (!on) {
    waitingInput = false;
    setInputMode(null);
  }
}

function setInputMode(prompt) {
  const row = $("#term-input-row");
  const input = $("#term-input");
  if (prompt !== null && waitingInput) {
    row.classList.add("waiting");
    $("#term-prompt").textContent = prompt.trim() ? "input ›" : "input ›";
    input.placeholder = "Type your answer and press Enter";
    showPanel();
    setTimeout(() => input.focus(), 30);
  } else {
    row.classList.remove("waiting");
    $("#term-prompt").textContent = ">>>";
    input.placeholder = "Python REPL — type code and press Enter";
  }
}

let stackSwitching = true;
async function runActive() {
  if (running) return;
  const path = ws.active;
  if (!path) return toast("Open a .py file to run");
  if (!path.endsWith(".py")) return toast("Only .py files can be run");
  if (!py.ready) {
    pendingRun = true;
    $("#btn-run").classList.add("loading");
    toast("Python is still starting — will run when ready");
    return;
  }
  let stdinLines = [];
  if (!stackSwitching && /\binput\s*\(/.test(Object.values(ws.files).join("\n"))) {
    // Old WebView without stack switching: collect input lines up front.
    const v = await dialog({ title: "Program input", body: "This program uses input(). Type each answer on its own line:", value: "", ok: "Run", multiline: true });
    if (v === null) return;
    stdinLines = v.split("\n");
  }
  if (!isWide()) closeSidebar();
  showPanel();
  if (S.clearOnRun) term.clear();
  term.forceScroll();
  term.writeln(`$ python ${path}`, "cmd");
  setRunning(true);
  py.run({ ...ws.files }, path, stdinLines);
}

function stopRun() {
  py.restart();
  replBusy = false;
  term.flushNow();
  term.ensureLineEnd();
  term.writeln("[Stopped — restarting Python…]", "err sys");
  setRunning(false);
  setPyStatus("Python restarting…", "busy");
  restored = false;
}

function mergeOutputFiles(files) {
  let changed = false;
  for (const [p, content] of Object.entries(files)) {
    if (ws.files[p] !== content) {
      const isNew = !(p in ws.files);
      ws.files[p] = content;
      const m = models.get(p);
      if (m && m.getValue() !== content) m.setValue(content);
      changed = true;
      if (isNew) term.writeln(`[new file: ${p}]`, "sys");
    }
  }
  if (changed) {
    save();
    renderTree();
  }
}

// Terminal input row: answers input() while a program waits, otherwise runs REPL code.
const replHistory = ws.history || (ws.history = []);
let histIdx = -1;
$("#term-input-row").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#term-input");
  const v = input.value;
  if (waitingInput) {
    waitingInput = false;
    term.write(v + "\n", "in");
    py.sendInput(v);
    input.value = "";
    setInputMode(null);
    return;
  }
  if (running || replBusy) return toast("Program is running — press Stop first");
  if (!v.trim()) return;
  if (!py.ready) return toast("Python is still starting…");
  term.forceScroll();
  term.write(">>> " + v.split("\n").join("\n... ") + "\n", "cmd");
  replHistory.push(v);
  if (replHistory.length > 100) replHistory.shift();
  histIdx = -1;
  save();
  input.value = "";
  replBusy = true;
  setRunning(true);
  py.repl(v);
});
$("#term-input").addEventListener("keydown", (e) => {
  if (waitingInput) return;
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    if (!replHistory.length) return;
    e.preventDefault();
    if (e.key === "ArrowUp") histIdx = histIdx < 0 ? replHistory.length - 1 : Math.max(0, histIdx - 1);
    else histIdx = histIdx < 0 ? -1 : histIdx + 1 >= replHistory.length ? -1 : histIdx + 1;
    e.target.value = histIdx < 0 ? "" : replHistory[histIdx];
  }
});

// ---------------------------------------------------------------- linting
let lintTimer;
function scheduleLint() {
  clearTimeout(lintTimer);
  if (!S.lint) return;
  lintTimer = setTimeout(async () => {
    const path = ws.active;
    if (!path || !path.endsWith(".py") || running) return;
    const r = await checkSyntax(monaco, py, modelFor(path), path);
    const st = $("#st-err");
    if (r) {
      st.hidden = false;
      st.textContent = `⊗ Ln ${r.line}: ${r.msg}`;
    } else st.hidden = true;
  }, 700);
}

// ---------------------------------------------------------------- file icons
function fileIcon(path) {
  const ext = path.split(".").pop().toLowerCase();
  if (ext === "py" || ext === "pyw")
    return `<svg class="ficon" viewBox="0 0 24 24" style="stroke:none"><path fill="#3b82f6" d="M11.9 2C7 2 7.3 4.1 7.3 4.1v2.2h4.7V7H5.4S2 6.6 2 11.9s3 5.1 3 5.1h1.8v-2.5s-.1-3 3-3h4.6s2.9.1 2.9-2.8V4.9S17.7 2 11.9 2zM9.3 3.5a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8z"/><path fill="#facc15" d="M12.1 22c4.9 0 4.6-2.1 4.6-2.1v-2.2H12V17h6.6s3.4.4 3.4-4.9-3-5.1-3-5.1h-1.8v2.5s.1 3-3 3H9.6s-2.9-.1-2.9 2.8v4.8S6.3 22 12.1 22zm2.6-1.5a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z"/></svg>`;
  const color = { md: "#60a5fa", json: "#facc15", txt: "#94a3b8", csv: "#4ade80", html: "#f97316", css: "#38bdf8", js: "#facc15" }[ext] || "#94a3b8";
  return `<svg class="ficon" viewBox="0 0 24 24" style="color:${color}"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/></svg>`;
}
const folderIcon = (open) =>
  `<svg class="ficon" viewBox="0 0 24 24" style="color:#a78bfa">${open ? '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H7.5a2 2 0 0 0-1.9 1.4L3 19z"/><path d="M5.6 11.4A2 2 0 0 1 7.5 10H22l-2.6 7.6a2 2 0 0 1-1.9 1.4H3z"/>' : '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'}</svg>`;
const chev = `<svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>`;
const dots = `<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></svg>`;

// ---------------------------------------------------------------- explorer tree
let selectedFolder = ""; // where "new file" goes
function renderTree() {
  const tree = $("#tree");
  tree.innerHTML = "";
  const folders = allFolders();
  const files = Object.keys(ws.files).sort();
  const childrenOf = (dir) => {
    const depth = dir ? dir.split("/").length : 0;
    const isChild = (p) => (dir ? p.startsWith(dir + "/") : true) && p.split("/").length === depth + 1;
    return {
      dirs: folders.filter(isChild).sort((a, b) => a.localeCompare(b)),
      files: files.filter(isChild).sort((a, b) => a.localeCompare(b)),
    };
  };
  const walk = (dir, depth) => {
    const { dirs, files: fs } = childrenOf(dir);
    for (const d of dirs) {
      const open = ws.expanded.includes(d);
      const row = document.createElement("div");
      row.className = "node folder" + (open ? " open" : "") + (selectedFolder === d ? " active" : "");
      row.style.paddingLeft = 8 + depth * 14 + "px";
      row.innerHTML = `${chev}${folderIcon(open)}<span class="name">${esc(d.split("/").pop())}</span><button class="mini dots" aria-label="Folder actions">${dots}</button>`;
      row.onclick = (e) => {
        if (e.target.closest(".dots")) return folderMenu(e.target.closest(".dots"), d);
        selectedFolder = d;
        if (open) ws.expanded = ws.expanded.filter((x) => x !== d);
        else ws.expanded.push(d);
        save();
        renderTree();
      };
      addLongPress(row, () => folderMenu(row, d));
      tree.appendChild(row);
      if (open) walk(d, depth + 1);
    }
    for (const f of fs) {
      const row = document.createElement("div");
      row.className = "node file" + (ws.active === f ? " active" : "");
      row.style.paddingLeft = 22 + depth * 14 + "px";
      row.innerHTML = `${fileIcon(f)}<span class="name">${esc(f.split("/").pop())}</span><button class="mini dots" aria-label="File actions">${dots}</button>`;
      row.onclick = (e) => {
        if (e.target.closest(".dots")) return fileMenu(e.target.closest(".dots"), f);
        selectedFolder = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
        openFile(f);
        if (!isWide()) closeSidebar();
      };
      addLongPress(row, () => fileMenu(row, f));
      tree.appendChild(row);
    }
  };
  walk("", 0);
  if (!files.length && !folders.length) {
    tree.innerHTML = `<div class="pad hint">No files yet. Tap + to create one.</div>`;
  }
}

function addLongPress(el, fn) {
  let t;
  el.addEventListener("touchstart", () => (t = setTimeout(() => (navigator.vibrate?.(15), fn()), 520)), { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((ev) => el.addEventListener(ev, () => clearTimeout(t), { passive: true }));
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    fn();
  });
}

function esc(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function fileMenu(anchor, f) {
  openMenu(anchor, [
    ...(f.endsWith(".py") ? [{ label: "▶  Run this file", run: () => (openFile(f), runActive()) }] : []),
    { label: "Rename…", run: () => doRename(f) },
    { label: "Duplicate", run: () => doDuplicate(f) },
    { label: "Copy contents", run: () => copyText(ws.files[f]) },
    "-",
    { label: "Delete", danger: true, run: () => doDelete(f) },
  ]);
}
function folderMenu(anchor, d) {
  openMenu(anchor, [
    { label: "New file here…", run: () => newFile(d) },
    { label: "New folder here…", run: () => newFolder(d) },
    { label: "Rename…", run: () => doRename(d) },
    "-",
    { label: "Delete folder", danger: true, run: () => doDelete(d) },
  ]);
}

async function newFile(dir = selectedFolder) {
  const suggested = uniqueName(dir, "untitled.py");
  const base = dir ? dir + "/" : "";
  const name = await dialog({ title: "New file", body: "Use / to put it in a folder, e.g. utils/helpers.py", value: suggested, ok: "Create", select: [base.length, suggested.length - 3] });
  if (!name) return;
  try {
    let p = norm(name);
    if (!/\.\w+$/.test(p)) p += ".py";
    p = createFile(p, p.endsWith(".py") ? "" : "");
    const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    if (parent) for (const part of parent.split("/").map((_, i, a) => a.slice(0, i + 1).join("/"))) if (!ws.expanded.includes(part)) ws.expanded.push(part);
    renderTree();
    openFile(p);
    if (!isWide()) closeSidebar();
    setTimeout(() => editor.focus(), 80);
  } catch (e) {
    toast(e.message);
  }
}
async function newFolder(dir = selectedFolder) {
  const name = await dialog({ title: "New folder", value: dir ? dir + "/" : "", ok: "Create", select: [(dir ? dir + "/" : "").length, (dir ? dir + "/" : "").length] });
  if (!name) return;
  try {
    selectedFolder = createFolder(name);
    renderTree();
  } catch (e) {
    toast(e.message);
  }
}
async function doRename(p) {
  const leaf = p.split("/").pop();
  const dot = leaf.lastIndexOf(".");
  const start = p.length - leaf.length;
  const name = await dialog({ title: "Rename", value: p, ok: "Rename", select: [start, dot > 0 ? start + dot : p.length] });
  if (!name) return;
  try {
    const moved = rename(p, name);
    for (const [o, n] of Object.entries(moved)) {
      if (models.has(o)) {
        viewStates.set(n, viewStates.get(o));
        disposeModel(o);
      }
    }
    renderTree();
    renderTabs();
    if (ws.active) showFile(ws.active);
  } catch (e) {
    toast(e.message);
  }
}
function doDuplicate(f) {
  const dir = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
  const p = createFile(uniqueName(dir, f.split("/").pop()), ws.files[f]);
  renderTree();
  openFile(p);
}
async function doDelete(p) {
  const isFile = p in ws.files;
  const ok = await dialog({ title: `Delete ${isFile ? "file" : "folder"}?`, body: `"${p}" will be deleted permanently.`, ok: "Delete", danger: true });
  if (!ok) return;
  for (const g of remove(p)) disposeModel(g);
  renderTree();
  renderTabs();
  if (ws.active) showFile(ws.active);
  else showEmpty();
}

function copyText(text) {
  (navigator.clipboard?.writeText(text) || Promise.reject())
    .then(() => toast("Copied to clipboard"))
    .catch(() => {
      const ta = Object.assign(document.createElement("textarea"), { value: text });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast("Copied to clipboard");
    });
}

// Import files from the phone (file picker)
$("#file-import").addEventListener("change", async (e) => {
  for (const file of e.target.files) {
    if (file.size > 2 * 1024 * 1024) {
      toast(`${file.name} is too large (max 2 MB)`);
      continue;
    }
    const text = await file.text();
    const p = uniqueName(selectedFolder, file.name);
    createFile(p, text);
    openFile(p);
  }
  e.target.value = "";
  renderTree();
});

// ---------------------------------------------------------------- tabs
function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  for (const p of ws.open) {
    const t = document.createElement("div");
    t.className = "tab" + (p === ws.active ? " active" : "");
    t.title = p;
    t.innerHTML = `${fileIcon(p)}<span>${esc(p.split("/").pop())}</span><button class="close" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    t.onclick = (e) => {
      if (e.target.closest(".close")) return closeTab(p);
      openFile(p);
    };
    tabs.appendChild(t);
  }
  const act = tabs.querySelector(".tab.active");
  act?.scrollIntoView({ block: "nearest", inline: "nearest" });
  $("#title-file").textContent = ws.active || "";
}

function closeTab(p) {
  const i = ws.open.indexOf(p);
  if (i < 0) return;
  if (models.has(p)) viewStates.set(p, p === ws.active ? editor.saveViewState() : viewStates.get(p));
  ws.open.splice(i, 1);
  if (ws.active === p) ws.active = ws.open[i] || ws.open[i - 1] || null;
  save();
  renderTabs();
  renderTree();
  if (ws.active) showFile(ws.active);
  else showEmpty();
}

function openFile(p) {
  if (!(p in ws.files)) return;
  if (!ws.open.includes(p)) ws.open.push(p);
  if (ws.active && ws.active !== p && models.has(ws.active)) viewStates.set(ws.active, editor.saveViewState());
  ws.active = p;
  save();
  renderTabs();
  renderTree();
  showFile(p);
}

function showFile(p) {
  $("#empty-state").hidden = true;
  $("#editor").style.visibility = "visible";
  const m = modelFor(p);
  if (editor.getModel() !== m) {
    editor.setModel(m);
    const vs = viewStates.get(p);
    if (vs) editor.restoreViewState(vs);
  }
  $("#st-lang").textContent = langFor(p) === "python" ? "Python" : langFor(p);
  scheduleLint();
}

function showEmpty() {
  editor.setModel(null);
  $("#editor").style.visibility = "hidden";
  $("#empty-state").hidden = false;
  $("#title-file").textContent = "";
  $("#st-err").hidden = true;
}

editor.onDidChangeCursorPosition((e) => {
  $("#st-pos").textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
});

// ---------------------------------------------------------------- search
let searchTimer;
$("#search-input").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => doSearch(e.target.value), 200);
});
function doSearch(q) {
  const out = $("#search-results");
  out.innerHTML = "";
  if (!q) return;
  const ql = q.toLowerCase();
  let total = 0;
  for (const p of Object.keys(ws.files).sort()) {
    const lines = ws.files[p].split("\n");
    const hits = [];
    lines.forEach((l, i) => {
      const idx = l.toLowerCase().indexOf(ql);
      if (idx >= 0) hits.push([i + 1, l, idx]);
    });
    if (!hits.length) continue;
    out.insertAdjacentHTML("beforeend", `<div class="sr-file">${esc(p)} <span class="hint">(${hits.length})</span></div>`);
    for (const [ln, l, idx] of hits.slice(0, 50)) {
      const d = document.createElement("div");
      d.className = "sr-hit";
      const s = Math.max(0, idx - 20);
      d.innerHTML = `<span class="ln">${ln}</span>${esc(l.slice(s, idx))}<b>${esc(l.slice(idx, idx + q.length))}</b>${esc(l.slice(idx + q.length, idx + q.length + 60))}`;
      d.onclick = () => {
        openFile(p);
        if (!isWide()) closeSidebar();
        editor.setSelection(new monaco.Range(ln, idx + 1, ln, idx + 1 + q.length));
        editor.revealLineInCenter(ln);
        editor.focus();
      };
      out.appendChild(d);
    }
    total += hits.length;
  }
  if (!total) out.innerHTML = `<div class="hint">No results</div>`;
}

// ---------------------------------------------------------------- packages
function renderPackages() {
  const list = $("#pkg-list");
  const names = new Set([...ws.packages, ...pkgState.keys()]);
  if (!names.size) {
    list.innerHTML = `<div class="hint">Nothing installed yet.</div>`;
    return;
  }
  list.innerHTML = "";
  for (const n of names) {
    const st = pkgState.get(n) || "ok";
    const row = document.createElement("div");
    row.className = "pkg";
    row.innerHTML = `<span>${esc(n)}</span><span class="tag ${st}">${st === "busy" ? "installing…" : st === "bad" ? "failed — tap to remove" : "installed"}</span>`;
    if (st !== "busy")
      row.onclick = async () => {
        const ok = await dialog({ title: `Remove ${n}?`, body: "It will no longer be reinstalled when the app starts.", ok: "Remove", danger: true });
        if (!ok) return;
        ws.packages = ws.packages.filter((x) => x !== n);
        pkgState.delete(n);
        save();
        renderPackages();
      };
    list.appendChild(row);
  }
}
function installPkg() {
  const input = $("#pkg-input");
  const name = input.value.trim();
  if (!name) return;
  if (!py.ready) return toast("Python is still starting…");
  if (running) return toast("Wait for the program to finish");
  input.value = "";
  pkgState.set(name, "busy");
  renderPackages();
  term.writeln(`$ pip install ${name}`, "cmd");
  showPanel();
  py.install(name);
}
$("#pkg-install").onclick = installPkg;
$("#pkg-input").addEventListener("keydown", (e) => e.key === "Enter" && installPkg());

// ---------------------------------------------------------------- settings
function applySettings() {
  document.documentElement.dataset.theme = S.theme;
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue("--bg-2").trim();
  monaco.editor.setTheme(S.theme);
  editor.updateOptions({ fontSize: S.fontSize, wordWrap: S.wordWrap ? "on" : "off", minimap: { enabled: S.minimap } });
  for (const m of models.values()) if (!m.isDisposed()) m.updateOptions({ tabSize: +S.tabSize, insertSpaces: true });
  $("#keybar").hidden = !S.keybar;
  $("#term-input").style.fontSize = Math.max(13, S.fontSize - 1) + "px";
  $("#terminal").style.fontSize = Math.max(11, S.fontSize - 1) + "px";
  $("#set-font-val").textContent = S.fontSize + "px";
  if (!S.lint && ws.active && models.has(ws.active)) monaco.editor.setModelMarkers(models.get(ws.active), "python", []);
  save();
}
function bindSettings() {
  const bind = (id, key, conv = (v) => v, prop = "value") => {
    const el = $(id);
    el[prop] = S[key];
    el.addEventListener(prop === "checked" ? "change" : "input", () => {
      S[key] = conv(el[prop]);
      applySettings();
    });
  };
  bind("#set-theme", "theme");
  bind("#set-font", "fontSize", Number);
  bind("#set-tab", "tabSize", Number);
  bind("#set-wrap", "wordWrap", Boolean, "checked");
  bind("#set-minimap", "minimap", Boolean, "checked");
  bind("#set-keys", "keybar", Boolean, "checked");
  bind("#set-clear", "clearOnRun", Boolean, "checked");
  bind("#set-lint", "lint", Boolean, "checked");
  $("#btn-reset").onclick = async () => {
    const ok = await dialog({ title: "Reset workspace?", body: "All your files will be deleted and replaced by the starter files. This cannot be undone.", ok: "Reset", danger: true });
    if (!ok) return;
    reset();
    location.reload();
  };
}

// ---------------------------------------------------------------- sidebar & panel
function openSidebar(view) {
  if (view) switchView(view);
  app.classList.add("sidebar-open");
  app.classList.remove("sidebar-closed");
}
function closeSidebar() {
  app.classList.remove("sidebar-open");
}
function switchView(view) {
  document.querySelectorAll(".act").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  if (view === "search") setTimeout(() => $("#search-input").focus(), 50);
  if (view === "packages") renderPackages();
}
$("#btn-sidebar").onclick = () => {
  if (isWide()) app.classList.toggle("sidebar-closed");
  else app.classList.contains("sidebar-open") ? closeSidebar() : openSidebar();
};
$("#scrim").onclick = closeSidebar;
document.querySelectorAll(".act").forEach((b) =>
  b.addEventListener("click", () => {
    const active = b.classList.contains("active");
    if (isWide() && active) app.classList.toggle("sidebar-closed");
    else {
      app.classList.remove("sidebar-closed");
      switchView(b.dataset.view);
    }
  })
);

function showPanel() {
  app.classList.remove("panel-hidden");
}
$("#btn-panel-toggle").onclick = () => {
  app.classList.remove("panel-max");
  app.classList.toggle("panel-hidden");
};
$("#btn-panel-max").onclick = () => {
  app.classList.remove("panel-hidden");
  app.classList.toggle("panel-max");
};
$("#btn-clear").onclick = () => term.clear();
$("#panel-head").addEventListener("dblclick", () => app.classList.toggle("panel-max"));

// Drag to resize the terminal panel
(() => {
  const handle = $("#panel-resizer");
  const panel = $("#panel");
  let startY, startH;
  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    startH = panel.getBoundingClientRect().height;
    handle.setPointerCapture(e.pointerId);
    app.classList.remove("panel-hidden", "panel-max");
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    const total = $("#workbench").getBoundingClientRect().height;
    const h = Math.min(total - 80, Math.max(90, startH + (startY - e.clientY)));
    panel.style.setProperty("height", h + "px");
  });
  const end = () => (startY = null);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
})();

// ---------------------------------------------------------------- coding key bar
const KEYS = [
  ["⇥", "tab"], ["(", "("], [")", ")"], [":", ":"], ['"', '"'], ["'", "'"], ["=", "="], ["[", "["], ["]", "]"], ["{", "{"], ["}", "}"],
  ["_", "_"], ["#", "#"], [".", "."], [",", ","], ["+", "+"], ["-", "-"], ["*", "*"], ["/", "/"], ["<", "<"], [">", ">"], ["%", "%"], ["!", "!"],
  ["←", "left"], ["→", "right"], ["↑", "up"], ["↓", "down"], ["⇤", "outdent"], ["#⁄", "comment"], ["⌫ line", "delline"], ["↵ dup", "dupline"],
];
function buildKeybar() {
  const bar = $("#keybar");
  for (const [label, act] of KEYS) {
    const b = document.createElement("button");
    b.textContent = label;
    if (label.length > 2) b.className = "wide";
    // pointerdown + preventDefault keeps the soft keyboard open
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      keyAction(act);
    });
    bar.appendChild(b);
  }
}
function keyAction(act) {
  if (!editor.getModel()) return;
  editor.focus();
  const cmds = {
    tab: "tab", outdent: "outdent", comment: "editor.action.commentLine", delline: "editor.action.deleteLines", dupline: "editor.action.copyLinesDownAction",
    left: "cursorLeft", right: "cursorRight", up: "cursorUp", down: "cursorDown",
  };
  if (cmds[act]) {
    if (act === "tab") editor.trigger("keybar", "tab", null);
    else editor.trigger("keybar", cmds[act], null);
    return;
  }
  editor.trigger("keybar", "type", { text: act });
}

// ---------------------------------------------------------------- more menu & shortcuts
$("#btn-more").onclick = (e) =>
  openMenu(e.currentTarget, [
    { label: "New file…", run: () => newFile() },
    { label: "New folder…", run: () => newFolder() },
    { label: "Import file from phone…", run: () => $("#file-import").click() },
    "-",
    { label: "Find / Replace", kbd: "Ctrl+H", run: () => editor.getModel() && (editor.focus(), editor.trigger("menu", "editor.action.startFindReplaceAction", null)) },
    { label: "Command palette", kbd: "F1", run: () => editor.getModel() && (editor.focus(), editor.trigger("menu", "editor.action.quickCommand", null)) },
    { label: "Go to line…", kbd: "Ctrl+G", run: () => editor.getModel() && (editor.focus(), editor.trigger("menu", "editor.action.gotoLine", null)) },
    { label: "Copy file contents", run: () => ws.active && copyText(ws.files[ws.active]) },
    "-",
    { label: "Restart Python", run: () => stopRun() },
    { label: "Search in files", run: () => openSidebar("search") },
    { label: "Packages (pip)", run: () => openSidebar("packages") },
    { label: "Settings", run: () => openSidebar("settings") },
  ]);
$("#btn-run").onclick = runActive;
$("#btn-stop").onclick = stopRun;
$("#btn-undo").onclick = () => editor.getModel() && editor.trigger("bar", "undo", null);
$("#btn-redo").onclick = () => editor.getModel() && editor.trigger("bar", "redo", null);
$("#btn-new-file").onclick = () => newFile();
$("#btn-new-folder").onclick = () => newFolder();
$("#btn-import").onclick = () => $("#file-import").click();
$("#btn-empty-new").onclick = () => newFile("");
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, runActive);
editor.addCommand(monaco.KeyCode.F5, runActive);
editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => (save(true), toast("Saved")));
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") (e.preventDefault(), runActive());
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") (e.preventDefault(), $("#btn-sidebar").click());
  if ((e.ctrlKey || e.metaKey) && e.key === "`") (e.preventDefault(), $("#btn-panel-toggle").click());
});

// Android hardware back button closes overlays first (Capacitor fires 'backbutton' via history)
window.addEventListener("popstate", () => {
  if (!$("#menu").hidden) closeMenu();
  else if (!$("#dialog-backdrop").hidden) $("#dialog-cancel").click();
  else if (app.classList.contains("sidebar-open")) closeSidebar();
  history.pushState(null, "", location.href);
});
history.pushState(null, "", location.href);

document.addEventListener("visibilitychange", () => document.hidden && save(true));
window.addEventListener("pagehide", () => save(true));

// ---------------------------------------------------------------- boot
setupPython(monaco, py, () => stdlib);
buildKeybar();
bindSettings();
applySettings();
if (!isWide() && window.innerHeight < 700) document.documentElement.style.setProperty("--panel-h", "34%");
ws.open = ws.open.filter((p) => p in ws.files);
if (ws.active && !(ws.active in ws.files)) ws.active = ws.open[0] || null;
renderTree();
renderTabs();
if (ws.active) showFile(ws.active);
else showEmpty();
term.writeln("⟁ Madara PyIDE — Python runs right on this device.", "sys");
term.writeln("Tap ▶ Run, or type Python in the box below to use the REPL.", "sys");
