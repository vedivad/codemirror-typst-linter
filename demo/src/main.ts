import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstExtensions,
  TypstAnalyzer,
  TypstCompiler,
  TypstFormatter,
  TypstProject,
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

const [formatter, compiler, renderer, analyzer] = await Promise.all([
  TypstFormatter.create({ tab_spaces: 2, max_width: 80 }),
  TypstCompiler.create(),
  TypstRenderer.create(),
  TypstAnalyzer.create({ wasmUrl: tinymistWasmUrl }),
]);

const project = new TypstProject({ compiler, analyzer });
await project.setMany(files);

const filePaths = Object.keys(files);

// --- Editor state ---

let activeFile = filePaths[0];
let activeView: EditorView | null = null;

// --- Shared extensions (one plugin instance survives tab switches via shared extension refs) ---

const typstExtensions = await createTypstExtensions({
  project,
  filePath: () => activeFile,
  onCompile: async (result) => {
    updateDiagnostics(diagnosticsEl, result.diagnostics);
    if (result.vector) {
      const svg = await renderer.renderSvg(result.vector);
      previewEl.innerHTML = `<div class="svg-container">${svg}</div>`;
    }
  },
  formatter: { instance: formatter, formatOnSave: true },
  highlighting: { theme: "dark" },
});

const sharedExtensions = [basicSetup, oneDark, ...typstExtensions];

const states: Record<string, EditorState> = Object.fromEntries(
  Object.entries(files).map(([path, content]) => [
    path,
    EditorState.create({ doc: content, extensions: sharedExtensions }),
  ]),
);

// --- Tab switching ---

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

// --- PDF export ---

exportBtn.addEventListener("click", async () => {
  exportBtn.disabled = true;
  exportBtn.textContent = "Exporting…";
  try {
    const activeDoc = (
      activeView ? activeView.state : states[activeFile]
    ).doc.toString();
    await project.setText(activeFile, activeDoc);

    const pdf = await project.compilePdf();
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
