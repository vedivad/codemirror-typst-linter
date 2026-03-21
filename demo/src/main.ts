import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  AnalyzerSession,
  createTypstExtensions,
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
  TypstRenderer,
} from "@vedivad/codemirror-typst";
import { basicSetup, EditorView } from "codemirror";
import tinymistWasmUrl from "tinymist-web/pkg/tinymist_bg.wasm?url";
import { updateDiagnostics } from "./diagnostics";
import { files } from "./files";

// --- Typst setup ---

const diagnosticsEl = document.getElementById("diagnostics")!;
const previewEl = document.getElementById("preview")!;
const editorEl = document.getElementById("editor")!;
const tabsEl = document.getElementById("tabs")!;
const exportBtn = document.getElementById("export-pdf") as HTMLButtonElement;

const formatter = new TypstFormatter({ tab_spaces: 2, max_width: 80 });
const compiler = new TypstCompiler();
const renderer = new TypstRenderer();
const analyzer = new TypstAnalyzer({ wasmUrl: tinymistWasmUrl });
const session = new AnalyzerSession({ analyzer });

const filePaths = Object.keys(files);

// --- Editor states ---

let activeFile = filePaths[0];
let activeView: EditorView | null = null;

async function makeState(path: string, doc: string): Promise<EditorState> {
  const typstExtensions = await createTypstExtensions({
    filePath: path,
    getFiles: () => files,
    compiler: {
      instance: compiler,
      onCompile: async (result) => {
        if (result.vector) {
          const svg = await renderer.renderSvg(result.vector);
          previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
        }
      },
    },
    analyzer: { instance: analyzer, session },
    formatter: { instance: formatter, formatOnSave: true },
    highlighting: { theme: "dark" },
    onDiagnostics: (d) => {
      if (path === activeFile)
        updateDiagnostics(diagnosticsEl, d, activeView?.state.doc);
    },
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
    const pdf = await compiler.compilePdf(files);
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
