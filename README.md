# ⟁ Madara PyIDE

A VS Code–style Python IDE for Android. Write and run real Python on your phone — **fully offline**.

- **Editor:** Monaco, the same editor engine that powers VS Code (syntax highlighting, autocomplete, multi-cursor, find/replace, command palette, bracket colours, sticky scroll)
- **Python 3.14** via [Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), bundled inside the APK — no server, no internet needed to run code
- **Live `input()`** — the program pauses and waits for you to type in the terminal
- **Multi-file projects** with folders — `from greet import banner` just works
- **Terminal** with coloured output (ANSI), `\r` progress lines, clean tracebacks, and a **Python REPL**
- **Stop button** that kills infinite loops instantly
- **Live syntax check** — red squiggles from CPython's own compiler as you type
- **Smart completion** — keywords, built-ins, snippets (`def`, `class`, `ifmain`, `try`…), every stdlib module after `import`, and real members after `math.` / `os.path.` / `random.`
- **pip packages** (needs internet): numpy, pandas, matplotlib, scipy, requests, rich and any pure-Python package from PyPI. Imports are auto-installed when you run.
- **matplotlib plots** render right inside the terminal
- Files your program writes (e.g. `open("notes.txt", "w")`) appear in the Explorer
- **Coding key bar** above the keyboard: Tab, brackets, quotes, `:`, `=`, arrows, comment, duplicate/delete line
- Search across files, rename / duplicate / delete, import files from your phone
- Themes: Madara Dark (cyan neon), Dark Modern, Light, High Contrast
- Everything auto-saves on the device

## 📱 Get the APK

The APK is built automatically by **GitHub Actions** every time code is pushed to `main`.

1. Open this repo → **Releases** (right side on desktop, or scroll down on mobile) → the latest **Madara PyIDE v1.0.x**.
2. Download `MadaraPyIDE-v1.0.x.apk` on your Android phone.
3. Open it → allow **Install unknown apps** for your browser/file manager when asked → **Install**.

Alternative: **Actions** tab → latest green ✅ run → **Artifacts** → `MadaraPyIDE-apk` (a zip containing the APK).

To build again without changing code: **Actions → Build APK → Run workflow**.

Every build has a higher version number and the same signing key, so new APKs install as updates and keep your files.

> Live `input()` needs a recent **Android System WebView** (Chrome 137+). On very old phones the app still works but asks for input lines before running — update "Android System WebView" from the Play Store to fix that.

## 🛠️ Develop on a computer

```bash
npm install
npm run dev      # opens the IDE in your browser with hot reload
npm run build    # production build into www/
```

Build the APK locally (needs Android Studio / Android SDK + JDK 21):

```bash
npm run build
npx cap add android        # first time only
npx cap sync android
cd android && ./gradlew assembleDebug
```

## Project layout

| Path | What it is |
| --- | --- |
| `index.html`, `src/` | The IDE UI (editor, explorer, tabs, terminal, settings) |
| `src/python-lang.js` | Python completion, hover, live syntax check |
| `public/py-worker.mjs` | The Python engine — runs Pyodide in a Web Worker |
| `scripts/copy-pyodide.mjs` | Copies the Python runtime into the app at build time |
| `capacitor.config.json` | Android app id / name |
| `resources/` | App icon |
| `.github/workflows/build-apk.yml` | Builds and releases the APK |

Made by **Madara Defaulter** (dev-shubh-madara).
