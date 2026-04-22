import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  createTypstExtensions,
  typstFilePath,
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

// --- Editor state ---

let activeFile = project.files[0];
let activeView: EditorView | null = null;

// --- Compile results → preview + diagnostics panel ---

project.onCompile(async (result) => {
  updateDiagnostics(diagnosticsEl, result.diagnostics);
  if (result.vector) {
    const pages = await renderer.renderSvgPages(result.vector);
    previewEl.innerHTML = `<div class="svg-container">${pages
      .map(
        (page) =>
          `<div class="svg-page" data-page="${page.index + 1}">${page.svg}</div>`,
      )
      .join("")}</div>`;
  }
});

// --- File management ---

async function addFile(rawName: string) {
  let path = rawName.trim();
  if (!path) return;
  if (!path.endsWith(".typ")) path += ".typ";
  if (!path.startsWith("/")) path = "/" + path;
  if (project.files.includes(path)) {
    alert(`"${path}" already exists.`);
    return;
  }

  await project.setText(path, "");
  states[path] = EditorState.create({
    doc: "",
    extensions: [...sharedExtensions, typstFilePath.of(path)],
  });
  switchTab(path); // path change triggers the plugin to compile
}

async function removeFile(path: string) {
  const paths = project.files;
  if (paths.length <= 1) return; // must keep at least one file
  const idx = paths.indexOf(path);
  delete states[path];
  await project.remove(path);
  if (activeFile === path) {
    const remaining = project.files;
    switchTab(remaining[Math.max(0, idx - 1)]);
  } else {
    await project.compile();
    renderTabs();
  }
}

// --- Editor extensions ---

const typstExtensions = await createTypstExtensions({
  project,
  formatter: { instance: formatter, formatOnSave: true },
  highlighting: { theme: "dark" },
});

const sharedExtensions = [basicSetup, oneDark, ...typstExtensions];

const states: Record<string, EditorState> = Object.fromEntries(
  project.files.map((path) => [
    path,
    EditorState.create({
      doc: project.getText(path) ?? "",
      extensions: [...sharedExtensions, typstFilePath.of(path)],
    }),
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

  const paths = project.files;
  for (const path of paths) {
    const tabContainer = document.createElement("div");
    tabContainer.className = "tab-container";

    const tab = document.createElement("button");
    tab.className = `tab${path === activeFile ? " active" : ""}`;
    tab.textContent = path.replace(/^\//, "");
    tab.onclick = () => switchTab(path);
    tabContainer.appendChild(tab);

    if (paths.length > 1) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = `Close ${path}`;
      closeBtn.onclick = async (e) => {
        e.stopPropagation();
        await removeFile(path);
      };
      tabContainer.appendChild(closeBtn);
    }

    tabsEl.appendChild(tabContainer);
  }

  // Add "new file" button
  const addBtn = document.createElement("button");
  addBtn.className = "tab-add";
  addBtn.textContent = "+";
  addBtn.title = "Add new file";
  addBtn.onclick = () => showNewFileInput();
  tabsEl.appendChild(addBtn);
}

function showNewFileInput() {
  // Check if input is already visible
  const existing = tabsEl.querySelector(".tab-new-file-input");
  if (existing) return;

  const inputContainer = document.createElement("div");
  inputContainer.className = "tab-new-file-input";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "filename.typ";
  input.className = "new-file-input";

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Add";
  confirmBtn.className = "new-file-confirm";
  confirmBtn.onclick = () => {
    const name = input.value;
    if (name) {
      addFile(name);
    }
    inputContainer.remove();
  };

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "new-file-cancel";
  cancelBtn.onclick = () => inputContainer.remove();

  inputContainer.appendChild(input);
  inputContainer.appendChild(confirmBtn);
  inputContainer.appendChild(cancelBtn);
  tabsEl.appendChild(inputContainer);

  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmBtn.click();
    if (e.key === "Escape") cancelBtn.click();
  });
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
