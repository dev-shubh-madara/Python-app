// Python language smarts for Monaco: keywords, builtins, snippets, offline module-member completion,
// import completion from the real stdlib list, and live syntax checking via CPython's compile().
const KEYWORDS = [
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif", "else",
  "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise",
  "return", "try", "while", "with", "yield", "match", "case",
];

const BUILTINS = {
  print: "print(*values, sep=' ', end='\\n', file=None, flush=False)",
  input: "input(prompt='') -> str",
  len: "len(obj) -> int", range: "range(start, stop[, step])", int: "int(x=0) / int(x, base=10)", float: "float(x=0.0)",
  str: "str(object='')", list: "list(iterable=())", dict: "dict(**kwargs)", set: "set(iterable=())", tuple: "tuple(iterable=())",
  bool: "bool(x=False)", abs: "abs(x)", sum: "sum(iterable, /, start=0)", min: "min(iterable, *, key=None)", max: "max(iterable, *, key=None)",
  sorted: "sorted(iterable, /, *, key=None, reverse=False)", reversed: "reversed(sequence)", enumerate: "enumerate(iterable, start=0)",
  zip: "zip(*iterables, strict=False)", map: "map(func, *iterables)", filter: "filter(function, iterable)", open: "open(file, mode='r', encoding=None)",
  round: "round(number, ndigits=None)", type: "type(object)", isinstance: "isinstance(obj, class_or_tuple)", issubclass: "issubclass(cls, class_or_tuple)",
  hasattr: "hasattr(obj, name)", getattr: "getattr(obj, name[, default])", setattr: "setattr(obj, name, value)", dir: "dir([object])",
  help: "help([object])", id: "id(obj)", hash: "hash(obj)", ord: "ord(c)", chr: "chr(i)", bin: "bin(x)", hex: "hex(x)", oct: "oct(x)",
  pow: "pow(base, exp, mod=None)", divmod: "divmod(a, b)", all: "all(iterable)", any: "any(iterable)", iter: "iter(object)", next: "next(iterator[, default])",
  format: "format(value, format_spec='')", repr: "repr(obj)", callable: "callable(obj)", vars: "vars([object])", globals: "globals()", locals: "locals()",
  super: "super()", object: "object()", property: "property(fget=None, fset=None)", staticmethod: "staticmethod(function)", classmethod: "classmethod(function)",
  frozenset: "frozenset(iterable=())", bytes: "bytes(source)", bytearray: "bytearray(source)", complex: "complex(real=0, imag=0)", slice: "slice(start, stop, step)",
  eval: "eval(source, globals=None, locals=None)", exec: "exec(source, globals=None, locals=None)", breakpoint: "breakpoint()",
  Exception: "class Exception", ValueError: "class ValueError", TypeError: "class TypeError", KeyError: "class KeyError", IndexError: "class IndexError",
  ZeroDivisionError: "class ZeroDivisionError", FileNotFoundError: "class FileNotFoundError", RuntimeError: "class RuntimeError",
  StopIteration: "class StopIteration", AttributeError: "class AttributeError", ImportError: "class ImportError", NotImplementedError: "class NotImplementedError",
};

const SNIPPETS = [
  ["def", "def ${1:name}(${2:args}):\n\t${3:pass}", "Function"],
  ["class", "class ${1:Name}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}", "Class"],
  ["ifmain", 'if __name__ == "__main__":\n\t${1:main()}', "if __name__ == '__main__'"],
  ["for", "for ${1:item} in ${2:items}:\n\t${3:pass}", "For loop"],
  ["forr", "for ${1:i} in range(${2:10}):\n\t${3:pass}", "For in range"],
  ["fore", "for ${1:i}, ${2:item} in enumerate(${3:items}):\n\t${4:pass}", "For with enumerate"],
  ["while", "while ${1:condition}:\n\t${2:pass}", "While loop"],
  ["if", "if ${1:condition}:\n\t${2:pass}", "If"],
  ["ifelse", "if ${1:condition}:\n\t${2:pass}\nelse:\n\t${3:pass}", "If / else"],
  ["try", "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:print(e)}", "Try / except"],
  ["with", 'with open("${1:file.txt}", "${2:r}") as ${3:f}:\n\t${4:data = f.read()}', "With open"],
  ["lc", "[${1:x} for ${2:x} in ${3:items}]", "List comprehension"],
  ["dc", "{${1:k}: ${2:v} for ${1:k}, ${2:v} in ${3:items}}", "Dict comprehension"],
  ["main", "def main():\n\t${1:pass}\n\n\nif __name__ == \"__main__\":\n\tmain()", "main() scaffold"],
  ["dataclass", "from dataclasses import dataclass\n\n\n@dataclass\nclass ${1:Name}:\n\t${2:field}: ${3:int}", "Dataclass"],
  ["match", "match ${1:value}:\n\tcase ${2:pattern}:\n\t\t${3:pass}\n\tcase _:\n\t\t${4:pass}", "Match statement"],
  ["pr", 'print(f"${1:{value}}")', "print f-string"],
];

const KIND_MAP = (monaco) => ({
  module: monaco.languages.CompletionItemKind.Module,
  class: monaco.languages.CompletionItemKind.Class,
  function: monaco.languages.CompletionItemKind.Function,
  variable: monaco.languages.CompletionItemKind.Variable,
});

function parseImports(text) {
  // returns [[alias, module], ...]
  const out = [];
  for (const line of text.split("\n")) {
    let m = line.match(/^\s*import\s+(.+)$/);
    if (m) {
      for (const part of m[1].split(",")) {
        const mm = part.trim().match(/^([\w.]+)(?:\s+as\s+(\w+))?/);
        if (mm) {
          if (mm[2]) out.push([mm[2], mm[1]]);
          else out.push([mm[1].split(".")[0], mm[1].split(".")[0]]);
        }
      }
      continue;
    }
    m = line.match(/^\s*from\s+([\w.]+)\s+import\s+(.+)$/);
    if (m) {
      for (const part of m[2].replace(/[()]/g, "").split(",")) {
        const mm = part.trim().match(/^(\w+)(?:\s+as\s+(\w+))?/);
        if (mm) out.push([mm[2] || mm[1], m[1] + "." + mm[1]]);
      }
    }
  }
  return out;
}

export function setupPython(monaco, py, getStdlib) {
  const kinds = KIND_MAP(monaco);

  monaco.languages.setLanguageConfiguration("python", {
    comments: { lineComment: "#", blockComment: ['"""', '"""'] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [
      { open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" },
      { open: '"', close: '"', notIn: ["string"] }, { open: "'", close: "'", notIn: ["string", "comment"] },
    ],
    surroundingPairs: [{ open: "{", close: "}" }, { open: "[", close: "]" }, { open: "(", close: ")" }, { open: '"', close: '"' }, { open: "'", close: "'" }],
    onEnterRules: [
      { beforeText: /:\s*(#.*)?$/, action: { indentAction: monaco.languages.IndentAction.Indent } },
      { beforeText: /^\s*(return|pass|break|continue|raise)\b.*$/, action: { indentAction: monaco.languages.IndentAction.Outdent } },
    ],
    folding: { offSide: true, markers: { start: /^\s*#\s*region\b/, end: /^\s*#\s*endregion\b/ } },
  });

  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: [".", " "],
    async provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);

      // import completion: "import xx" / "from xx"
      const imp = line.match(/^\s*(?:import|from)\s+([\w]*)$/);
      if (imp) {
        return {
          suggestions: getStdlib().map((m) => ({ label: m, kind: kinds.module, insertText: m, range })),
        };
      }

      // attribute completion: "math." / "os.path." / "self." etc.
      const attr = line.match(/([A-Za-z_][\w.]*)\.(\w*)$/);
      if (attr) {
        const r = await py.ask("complete", { expr: attr[1], imports: parseImports(model.getValue()) });
        return {
          suggestions: (r.items || []).map(([name, kind, doc]) => ({
            label: name,
            kind: kinds[kind] || kinds.variable,
            insertText: name,
            detail: kind,
            documentation: doc,
            range,
            sortText: (name.startsWith("_") ? "z" : "a") + name,
          })),
        };
      }
      if (line.endsWith(" ") && !/\b(def|class|import|from|for|in|as|with)\s$/.test(line)) return { suggestions: [] };

      const suggestions = [];
      for (const k of KEYWORDS) suggestions.push({ label: k, kind: monaco.languages.CompletionItemKind.Keyword, insertText: k, range });
      for (const [b, sig] of Object.entries(BUILTINS))
        suggestions.push({
          label: b,
          kind: /^[A-Z]/.test(b) ? kinds.class : kinds.function,
          insertText: b,
          detail: sig,
          range,
        });
      for (const [label, body, doc] of SNIPPETS)
        suggestions.push({
          label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: doc,
          documentation: body.replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\t/g, "    "),
          range,
          sortText: "~" + label,
        });
      // names defined in this file
      const seen = new Set();
      const text = model.getValue();
      for (const m of text.matchAll(/^\s*(?:def|class)\s+(\w+)|^\s*(\w+)\s*=(?!=)/gm)) {
        const n = m[1] || m[2];
        if (n && !seen.has(n)) {
          seen.add(n);
          suggestions.push({ label: n, kind: m[1] ? kinds.function : kinds.variable, insertText: n, range });
        }
      }
      for (const [alias] of parseImports(text)) if (!seen.has(alias)) (seen.add(alias), suggestions.push({ label: alias, kind: kinds.module, insertText: alias, range }));
      return { suggestions };
    },
  });

  monaco.languages.registerHoverProvider("python", {
    provideHover(model, position) {
      const w = model.getWordAtPosition(position);
      if (!w || !BUILTINS[w.word]) return null;
      return { contents: [{ value: "```python\n" + BUILTINS[w.word] + "\n```" }] };
    },
  });
}

// Live syntax check (debounced by caller). Puts red squiggles where CPython reports a SyntaxError.
export async function checkSyntax(monaco, py, model, path) {
  const r = await py.ask("check", { code: model.getValue(), path });
  if (r.skip) return null;
  if (model.isDisposed()) return null;
  if (!r.error) {
    monaco.editor.setModelMarkers(model, "python", []);
    return null;
  }
  const [line, col, endLine, endCol, msg] = r.error;
  const maxLine = model.getLineCount();
  const l = Math.min(Math.max(line, 1), maxLine);
  const el = Math.min(Math.max(endLine, l), maxLine);
  let ec = endCol;
  if (el === l && ec <= col) ec = col + 1;
  if (el === l && ec > model.getLineMaxColumn(l)) ec = model.getLineMaxColumn(l);
  monaco.editor.setModelMarkers(model, "python", [
    { severity: monaco.MarkerSeverity.Error, message: msg, startLineNumber: l, startColumn: Math.max(col, 1), endLineNumber: el, endColumn: Math.max(ec, col + 1) },
  ]);
  return { line: l, msg };
}
