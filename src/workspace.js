// Workspace: files + folders + UI state, persisted in the app's local storage (stays on the phone).
const KEY = "madara-pyide:v1";

const SAMPLES = {
  "main.py": `# ⟁ Welcome to Madara PyIDE
# Real Python running on your phone — fully offline.
# Tap ▶ Run (or Ctrl+Enter on a keyboard).

from greet import banner

banner("Madara PyIDE")

name = input("What's your name? ")
print(f"Hello, {name}! 👋")

nums = [n * n for n in range(1, 11)]
print("Squares:", nums)
print("Sum:", sum(nums))
`,
  "greet.py": `def banner(text: str) -> None:
    """Print a boxed banner. Imported by main.py — multi-file projects work."""
    line = "═" * (len(text) + 4)
    print(f"╔{line}╗")
    print(f"║  {text}  ║")
    print(f"╚{line}╝")
`,
  "examples/fizzbuzz.py": `for i in range(1, 31):
    out = ""
    if i % 3 == 0:
        out += "Fizz"
    if i % 5 == 0:
        out += "Buzz"
    print(out or i)
`,
  "examples/classes.py": `from dataclasses import dataclass


@dataclass
class Ninja:
    name: str
    chakra: int = 100

    def jutsu(self, cost: int) -> None:
        if cost > self.chakra:
            raise ValueError(f"{self.name} is out of chakra!")
        self.chakra -= cost
        print(f"{self.name} used a jutsu. Chakra left: {self.chakra}")


madara = Ninja("Madara", chakra=250)
for cost in (80, 90, 60):
    madara.jutsu(cost)
`,
  "examples/files_demo.py": `# Files your program writes show up in the Explorer after it runs.
with open("notes.txt", "w") as f:
    for i in range(1, 6):
        f.write(f"line {i}\\n")

with open("notes.txt") as f:
    print(f.read())
`,
  "examples/plot.py": `# Needs internet the first time (downloads numpy + matplotlib).
import numpy as np
import matplotlib.pyplot as plt

x = np.linspace(0, 4 * np.pi, 400)
plt.plot(x, np.sin(x), label="sin")
plt.plot(x, np.cos(x), label="cos")
plt.title("Plots appear right in the terminal")
plt.legend()
plt.show()
`,
};

const DEFAULT_SETTINGS = {
  theme: "madara-dark",
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  minimap: false,
  keybar: true,
  clearOnRun: true,
  lint: true,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
      s.folders = s.folders || [];
      s.packages = s.packages || [];
      s.expanded = s.expanded || [];
      return s;
    }
  } catch (_) {}
  return fresh();
}

function fresh() {
  return {
    files: { ...SAMPLES },
    folders: ["examples"],
    expanded: ["examples"],
    open: ["main.py"],
    active: "main.py",
    packages: [],
    history: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export const ws = load();

let saveTimer = null;
export function save(now = false) {
  clearTimeout(saveTimer);
  const doit = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(ws));
    } catch (e) {
      console.warn("save failed", e);
    }
  };
  if (now) doit();
  else saveTimer = setTimeout(doit, 400);
}

export function reset() {
  Object.assign(ws, fresh());
  save(true);
}

export const norm = (p) =>
  p
    .replace(/\\/g, "/")
    .split("/")
    .filter((x) => x && x !== ".")
    .join("/");

export function allFolders() {
  const set = new Set(ws.folders);
  for (const p of Object.keys(ws.files)) {
    const parts = p.split("/");
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join("/"));
  }
  return [...set].sort();
}

export function exists(path) {
  return path in ws.files || allFolders().includes(path);
}

export function createFile(path, content = "") {
  path = norm(path);
  if (!path) throw new Error("Empty name");
  if (exists(path)) throw new Error(`"${path}" already exists`);
  ws.files[path] = content;
  save();
  return path;
}

export function createFolder(path) {
  path = norm(path);
  if (!path) throw new Error("Empty name");
  if (exists(path)) throw new Error(`"${path}" already exists`);
  ws.folders.push(path);
  if (!ws.expanded.includes(path)) ws.expanded.push(path);
  save();
  return path;
}

// Rename a file or folder. Returns a map old->new for every file moved.
export function rename(oldPath, newPath) {
  newPath = norm(newPath);
  if (!newPath) throw new Error("Empty name");
  if (newPath === oldPath) return {};
  if (exists(newPath)) throw new Error(`"${newPath}" already exists`);
  const moved = {};
  if (oldPath in ws.files) {
    ws.files[newPath] = ws.files[oldPath];
    delete ws.files[oldPath];
    moved[oldPath] = newPath;
  } else {
    const pre = oldPath + "/";
    for (const p of Object.keys(ws.files)) {
      if (p.startsWith(pre)) {
        const np = newPath + "/" + p.slice(pre.length);
        ws.files[np] = ws.files[p];
        delete ws.files[p];
        moved[p] = np;
      }
    }
    ws.folders = ws.folders.map((f) => (f === oldPath ? newPath : f.startsWith(pre) ? newPath + "/" + f.slice(pre.length) : f));
    ws.expanded = ws.expanded.map((f) => (f === oldPath ? newPath : f.startsWith(pre) ? newPath + "/" + f.slice(pre.length) : f));
  }
  ws.open = ws.open.map((p) => moved[p] || p);
  if (moved[ws.active]) ws.active = moved[ws.active];
  save();
  return moved;
}

// Delete a file or folder. Returns list of deleted file paths.
export function remove(path) {
  const gone = [];
  if (path in ws.files) {
    delete ws.files[path];
    gone.push(path);
  } else {
    const pre = path + "/";
    for (const p of Object.keys(ws.files)) if (p.startsWith(pre)) (delete ws.files[p], gone.push(p));
    ws.folders = ws.folders.filter((f) => f !== path && !f.startsWith(pre));
    ws.expanded = ws.expanded.filter((f) => f !== path && !f.startsWith(pre));
  }
  ws.open = ws.open.filter((p) => !gone.includes(p));
  if (gone.includes(ws.active)) ws.active = ws.open[ws.open.length - 1] || null;
  save();
  return gone;
}

export function uniqueName(dir, base) {
  const join = (n) => (dir ? dir + "/" + n : n);
  if (!exists(join(base))) return join(base);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  for (let i = 1; ; i++) {
    const n = join(`${stem}_${i}${ext}`);
    if (!exists(n)) return n;
  }
}

export function langFor(path) {
  const ext = path.split(".").pop().toLowerCase();
  return (
    {
      py: "python", pyw: "python", txt: "plaintext", md: "markdown", json: "json", csv: "plaintext",
      html: "html", css: "css", js: "javascript", toml: "ini", ini: "ini", cfg: "ini", yml: "yaml", yaml: "yaml", xml: "xml", sql: "sql", sh: "shell",
    }[ext] || "plaintext"
  );
}
