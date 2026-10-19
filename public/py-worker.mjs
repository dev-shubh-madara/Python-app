// Madara PyIDE — Python engine (runs inside a module Web Worker so the UI never freezes).
// Pyodide = real CPython compiled to WebAssembly, bundled inside the app (works offline).
import { loadPyodide, version as PYODIDE_VERSION } from "./pyodide/pyodide.mjs";

const PROJECT = "/home/pyodide/project";
const CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

let py = null;
let busy = false;
let pendingInput = null; // { resolve }
let stdinQueue = []; // fallback stdin lines when stack switching is unavailable

// ---------- output batching ----------
// Timers can't fire while Python runs synchronously, so we flush by size/time inside write().
const out = { stdout: "", stderr: "" };
let lastFlush = 0;
function flush() {
  for (const k of ["stdout", "stderr"]) {
    if (out[k]) {
      postMessage({ type: k, text: out[k] });
      out[k] = "";
    }
  }
  lastFlush = Date.now();
}
function makeWriter(kind) {
  const dec = new TextDecoder();
  return {
    write(buf) {
      out[kind] += dec.decode(buf, { stream: true });
      const now = Date.now();
      if (out.stdout.length + out.stderr.length > 8192 || now - lastFlush > 30) flush();
      return buf.length;
    },
    isatty: true,
  };
}

// Called from Python (input()). Returns a Promise that resolves when the user submits a line.
self._ideRequestInput = (prompt) => {
  flush();
  return new Promise((resolve) => {
    pendingInput = { resolve };
    postMessage({ type: "input-request", prompt: String(prompt ?? "") });
  });
};
self._ideFallbackInput = () => (stdinQueue.length ? stdinQueue.shift() : null);
self._ideFlush = () => flush();
self._idePostImage = (b64) => {
  flush();
  postMessage({ type: "image", data: b64 });
};

const BOOTSTRAP = String.raw`
import sys, os, builtins, io, traceback, base64, keyword, importlib, inspect
import js
from pyodide.ffi import run_sync, can_run_sync

PROJECT = "${PROJECT}"
os.makedirs(PROJECT, exist_ok=True)
os.environ["MPLBACKEND"] = "Agg"

def _ide_input(prompt=""):
    prompt = str(prompt)
    if prompt:
        sys.stdout.write(prompt)
    sys.stdout.flush()
    js._ideFlush()
    if can_run_sync():
        value = run_sync(js._ideRequestInput(prompt))
    else:
        value = js._ideFallbackInput()
        if value is None:
            raise EOFError("No input available. Type lines into the Input box before running.")
        sys.stdout.write(str(value) + "\n")
    if value is None:
        raise EOFError("EOF when reading a line")
    return str(value)

builtins.input = _ide_input

def _ide_forget_project_modules():
    for name, mod in list(sys.modules.items()):
        f = getattr(mod, "__file__", None) or ""
        if f.startswith(PROJECT):
            del sys.modules[name]

def _ide_print_exc(e):
    te = traceback.TracebackException.from_exception(e)
    frames = [f for f in te.stack if f.filename.startswith(PROJECT) or f.filename == "<repl>"]
    te.stack = traceback.StackSummary.from_list(frames)
    text = "".join(te.format()).replace(PROJECT + "/", "")
    sys.stderr.write(text)
    if isinstance(e, ModuleNotFoundError):
        sys.stderr.write(f"\nTip: install it from the Packages tab (pip). Downloads need internet.\n")

def _ide_show_figures():
    if "matplotlib.pyplot" not in sys.modules:
        return
    plt = sys.modules["matplotlib.pyplot"]
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
        js._idePostImage(base64.b64encode(buf.getvalue()).decode())
    plt.close("all")

def _ide_run(entry):
    import runpy
    os.chdir(PROJECT)
    _ide_forget_project_modules()
    if PROJECT not in sys.path:
        sys.path.insert(0, PROJECT)
    d = os.path.dirname(os.path.join(PROJECT, entry))
    if d not in sys.path:
        sys.path.insert(0, d)
    sys.argv = [entry]
    ok = True
    try:
        runpy.run_path(os.path.join(PROJECT, entry), run_name="__main__")
    except SystemExit as e:
        if e.code not in (None, 0):
            sys.stderr.write(f"\n[process exited with code {e.code}]\n")
            ok = False
    except BaseException as e:
        _ide_print_exc(e)
        ok = False
    finally:
        try:
            _ide_show_figures()
        except Exception as e:
            sys.stderr.write(f"[could not render plot: {e}]\n")
        sys.stdout.flush(); sys.stderr.flush()
    return ok

_repl_ns = {"__name__": "__main__"}

async def _ide_repl(src):
    from pyodide.code import eval_code_async
    os.chdir(PROJECT)
    try:
        r = await eval_code_async(src, _repl_ns, filename="<repl>")
        if r is not None:
            print(repr(r))
    except SystemExit:
        pass
    except BaseException as e:
        _ide_print_exc(e)
    sys.stdout.flush(); sys.stderr.flush()

def _ide_check(src, path):
    try:
        compile(src, path, "exec")
        return None
    except SyntaxError as e:
        return [e.lineno or 1, e.offset or 1, e.end_lineno or e.lineno or 1, e.end_offset or (e.offset or 1) + 1, f"{type(e).__name__}: {e.msg}"]
    except Exception:
        return None

def _ide_kind(obj):
    if inspect.ismodule(obj): return "module"
    if inspect.isclass(obj): return "class"
    if callable(obj): return "function"
    return "variable"

def _ide_complete(expr, imports):
    # Offline attribute completion: resolves "a.b." on modules the file imports (no code execution).
    parts = expr.split(".")
    root = parts[0]
    obj = None
    alias = dict(imports)
    if root in alias:
        try:
            obj = importlib.import_module(alias[root])
        except BaseException:
            return []
    elif root in _repl_ns:
        obj = _repl_ns[root]
    elif hasattr(builtins, root):
        obj = getattr(builtins, root)
    else:
        lit = {"str": "", "list": [], "dict": {}, "set": set(), "int": 0, "float": 0.0}
        if root in lit:
            obj = lit[root]
        else:
            return []
    for p in parts[1:]:
        try:
            obj = inspect.getattr_static(obj, p)
        except BaseException:
            return []
    res = []
    for name in dir(obj):
        if name.startswith("__") and name.endswith("__"):
            continue
        try:
            v = inspect.getattr_static(obj, name)
            kind = _ide_kind(getattr(obj, name, v))
            doc = (inspect.getdoc(getattr(obj, name, v)) or "").strip().split("\n")[0][:160]
        except BaseException:
            kind, doc = "variable", ""
        res.append([name, kind, doc])
    return res

def _ide_collect():
    files = {}
    for base, dirs, names in os.walk(PROJECT):
        dirs[:] = [d for d in dirs if d != "__pycache__" and not d.startswith(".")]
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, PROJECT)
            try:
                if os.path.getsize(p) > 512 * 1024:
                    continue
                with open(p, "r", encoding="utf-8") as fh:
                    files[rel] = fh.read()
            except Exception:
                pass
    return files

_ide_stdlib = sorted(m for m in sys.stdlib_module_names if not m.startswith("_"))
`;

async function boot() {
  postMessage({ type: "status", text: "Starting Python…" });
  const indexURL = new URL("./pyodide/", self.location.href).href;
  py = await loadPyodide({
    indexURL,
    packageBaseUrl: CDN,
    env: { HOME: "/home/pyodide", PYTHONUNBUFFERED: "1" },
  });
  py.setStdout(makeWriter("stdout"));
  py.setStderr(makeWriter("stderr"));
  py.setStdin({ stdin: () => self._ideFallbackInput() ?? undefined });
  py.runPython(BOOTSTRAP);
  const pyVersion = py.runPython("import sys; sys.version.split()[0]");
  const stdlib = py.globals.get("_ide_stdlib").toJs();
  postMessage({
    type: "ready",
    pyVersion,
    pyodideVersion: PYODIDE_VERSION,
    stackSwitching: typeof WebAssembly.Suspending === "function",
    stdlib,
  });
}

function syncFiles(files) {
  const FS = py.FS;
  // Clear project dir then write current files so deleted/renamed files disappear.
  const rm = (dir) => {
    for (const name of FS.readdir(dir)) {
      if (name === "." || name === "..") continue;
      const p = dir + "/" + name;
      const st = FS.stat(p);
      if (FS.isDir(st.mode)) {
        rm(p);
        FS.rmdir(p);
      } else FS.unlink(p);
    }
  };
  try {
    rm(PROJECT);
  } catch (_) {}
  for (const [path, content] of Object.entries(files)) {
    const full = PROJECT + "/" + path;
    const dir = full.slice(0, full.lastIndexOf("/"));
    FS.mkdirTree(dir);
    FS.writeFile(full, content);
  }
}

// Only the entry file and the project files it (transitively) imports are scanned, so an unrelated
// example file importing matplotlib doesn't trigger a download.
function reachableCode(files, entry) {
  const seen = new Set();
  const stack = [entry];
  const entryDir = entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/") + 1) : "";
  const resolve = (mod) => {
    const rel = mod.replace(/\./g, "/");
    for (const base of [entryDir, ""]) {
      for (const cand of [base + rel + ".py", base + rel + "/__init__.py"]) if (cand in files) return cand;
    }
    return null;
  };
  let code = "";
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p) || !(p in files)) continue;
    seen.add(p);
    const src = files[p];
    code += src + "\n";
    for (const m of src.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w., ]+))/gm)) {
      const mods = m[1] ? [m[1]] : m[2].split(",").map((s) => s.trim().split(/\s+/)[0]);
      for (const mod of mods) {
        const f = resolve(mod);
        if (f) stack.push(f);
      }
    }
  }
  return code;
}

async function autoLoadPackages(files, entry) {
  const code = entry ? reachableCode(files, entry) : Object.values(files).join("\n");
  try {
    await py.loadPackagesFromImports(code, {
      messageCallback: (m) => postMessage({ type: "info", text: m }),
      errorCallback: (m) => postMessage({ type: "info", text: m, error: true }),
    });
  } catch (e) {
    postMessage({ type: "info", error: true, text: "Could not download packages (are you online?): " + String(e.message || e).split("\n")[0] });
  }
}

async function handle(msg) {
  switch (msg.type) {
    case "run": {
      busy = true;
      stdinQueue = (msg.stdin || []).slice();
      try {
        syncFiles(msg.files);
        await autoLoadPackages(msg.files, msg.entry);
        py.globals.set("_ide_entry", msg.entry);
        const t0 = performance.now();
        const ok = await py.runPythonAsync("_ide_run(_ide_entry)");
        flush();
        const files = py.runPython("_ide_collect()").toJs({ dict_converter: Object.fromEntries });
        postMessage({ type: "done", ok, ms: Math.round(performance.now() - t0), files });
      } catch (e) {
        flush();
        postMessage({ type: "stderr", text: String(e.message || e) + "\n" });
        postMessage({ type: "done", ok: false, ms: 0 });
      }
      busy = false;
      break;
    }
    case "repl": {
      busy = true;
      try {
        await autoLoadPackages({ "repl.py": msg.code });
        py.globals.set("_ide_src", msg.code);
        await py.runPythonAsync("await _ide_repl(_ide_src)");
      } catch (e) {
        postMessage({ type: "stderr", text: String(e.message || e) + "\n" });
      }
      flush();
      busy = false;
      postMessage({ type: "repl-done" });
      break;
    }
    case "install": {
      busy = true;
      try {
        await py.loadPackage("micropip");
        const micropip = py.pyimport("micropip");
        await micropip.install(msg.name);
        postMessage({ type: "install-done", ok: true, name: msg.name });
      } catch (e) {
        const text = String(e.message || e).split("\n").filter(Boolean).slice(-3).join("\n");
        postMessage({ type: "install-done", ok: false, name: msg.name, error: text });
      }
      busy = false;
      break;
    }
    case "check": {
      if (busy) return postMessage({ type: "check-result", id: msg.id, skip: true });
      const fn = py.globals.get("_ide_check");
      const r = fn(msg.code, msg.path);
      postMessage({ type: "check-result", id: msg.id, path: msg.path, error: r ? r.toJs() : null });
      break;
    }
    case "complete": {
      if (busy) return postMessage({ type: "complete-result", id: msg.id, items: [] });
      try {
        const fn = py.globals.get("_ide_complete");
        const r = fn(msg.expr, py.toPy(msg.imports));
        postMessage({ type: "complete-result", id: msg.id, items: r.toJs() });
      } catch (e) {
        postMessage({ type: "complete-result", id: msg.id, items: [] });
      }
      break;
    }
  }
}

// Messages are queued so runs/installs never overlap; input/check/complete are handled immediately.
let queue = null; // set after boot() below
self.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "input") {
    if (pendingInput) {
      const p = pendingInput;
      pendingInput = null;
      p.resolve(msg.value);
    } else stdinQueue.push(msg.value);
    return;
  }
  if (msg.type === "check" || msg.type === "complete") {
    if (!py || busy) {
      postMessage({ type: msg.type + "-result", id: msg.id, items: [], skip: true });
      return;
    }
    handle(msg);
    return;
  }
  queue = queue.then(() => handle(msg)).catch((e) => postMessage({ type: "stderr", text: String(e) + "\n" }));
};

queue = boot().catch((e) => postMessage({ type: "fatal", text: String(e && e.stack ? e.stack : e) }));
