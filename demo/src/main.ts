import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstExtensions,
  TypstFormatter,
  TypstService,
} from "@vedivad/codemirror-typst";
import { basicSetup, EditorView } from "codemirror";
import { updateDiagnostics } from "./diagnostics";

// --- File contents ---

const files: Record<string, string> = {
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
const exportBtn = document.getElementById("export-pdf") as HTMLButtonElement;

const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });

const service = TypstService.create({
  renderer: {
    module: () => import("@myriaddreamin/typst-ts-renderer"),
    onSvg: (svg) => {
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    },
  },
});

const filePaths = Object.keys(files);

// --- Editor states ---

let activeFile = filePaths[0];
let activeView: EditorView | null = null;

async function makeState(path: string, doc: string): Promise<EditorState> {
  const typstExtensions = await createTypstExtensions({
    highlighting: {
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: "dark",
      engine: "javascript",
    },
    compiler: {
      service,
      filePath: path,
      getFiles: () => files,
      onDiagnostics: (d) => {
        if (path === activeFile)
          updateDiagnostics(diagnosticsEl, d, activeView?.state.doc);
      },
    },
    formatter: { formatter },
  });

  return EditorState.create({
    doc,
    extensions: [basicSetup, oneDark, ...typstExtensions],
  });
}

const states: Record<string, EditorState> = {};
await Promise.all(
  Object.entries(files).map(async ([path, content]) => {
    states[path] = await makeState(path, content);
  }),
);

// --- Tab switching ---

function switchTab(path: string) {
  if (activeView) {
    files[activeFile] = activeView.state.doc.toString();
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

// --- PDF export ---

exportBtn.addEventListener("click", async () => {
  if (activeView) {
    files[activeFile] = activeView.state.doc.toString();
  }
  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting…";
  try {
    const pdf = await service.renderPdf(files);
    const blob = new Blob([pdf.slice()], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "output.pdf";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("PDF export failed:", err);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = "Export PDF";
  }
});

// --- Init ---

switchTab(activeFile);
