import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstLinter,
  createTypstShikiExtension,
  TypstService,
} from "@vedivad/codemirror-typst";
import { basicSetup, EditorView } from "codemirror";
import { updateDiagnostics } from "./diagnostics";

// --- File contents ---

const initialFiles: Record<string, string> = {
  "/main.typ": `\
#import "template.typ": greet

#greet("World")

= Introduction

This demo shows *multi-file* compilation.
Each file is editable — switch tabs to see both.
`,
  "/template.typ": `\
#let greet(name) = {
  align(center, text(24pt, weight: "bold")[
    Hello, #name!
  ])
}
`,
};

// --- Service setup ---

const diagnosticsEl = document.getElementById("diagnostics")!;
const previewEl = document.getElementById("preview")!;
const editorEl = document.getElementById("editor")!;
const tabsEl = document.getElementById("tabs")!;

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => {
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    },
  },
});

// Seed the file store
for (const [path, content] of Object.entries(initialFiles)) {
  service.setFile(path, content);
}

// --- Shared extensions ---

const shikiExtension = await createTypstShikiExtension({
  themes: { light: "github-light", dark: "github-dark" },
  defaultColor: "dark",
  engine: "javascript",
});

// --- Per-file editor states ---

const filePaths = Object.keys(initialFiles);

function makeState(path: string, doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup,
      oneDark,
      shikiExtension,
      createTypstLinter({
        service,
        filePath: path,
        onDiagnostics: (d) => {
          if (path === activeFile) updateDiagnostics(diagnosticsEl, d);
        },
      }),
    ],
  });
}

const states: Record<string, EditorState> = {};
for (const [path, content] of Object.entries(initialFiles)) {
  states[path] = makeState(path, content);
}

// --- Tab switching ---

let activeFile = filePaths[0];
let activeView: EditorView | null = null;

function switchTab(path: string) {
  if (activeView) {
    states[activeFile] = activeView.state;
  }

  activeFile = path;

  if (activeView) {
    activeView.setState(states[path]);
  } else {
    activeView = new EditorView({
      state: states[path],
      parent: editorEl,
    });
  }

  renderTabs();
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const path of filePaths) {
    const tab = document.createElement("button");
    tab.className = `tab${path === activeFile ? " active" : ""}`;
    tab.textContent = path.replace(/^\//, "");
    tab.onclick = () => switchTab(path);
    tabsEl.appendChild(tab);
  }
}

// --- Init ---

switchTab(activeFile);
