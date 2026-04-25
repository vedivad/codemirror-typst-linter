export interface RenderTabsOptions {
  root: HTMLElement;
  paths: string[];
  activeFile: string;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function renderTabs(opts: RenderTabsOptions): void {
  const { root, paths, activeFile, onSelect, onClose, onAdd } = opts;
  root.innerHTML = "";

  for (const path of paths) {
    const tabContainer = document.createElement("div");
    tabContainer.className = "tab-container";

    const tab = document.createElement("button");
    tab.className = `tab${path === activeFile ? " active" : ""}`;
    tab.textContent = path.replace(/^\//, "");
    tab.onclick = () => onSelect(path);
    tabContainer.appendChild(tab);

    if (paths.length > 1) {
      const closeBtn = document.createElement("button");
      closeBtn.className = "tab-close";
      closeBtn.textContent = "×";
      closeBtn.title = `Close ${path}`;
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        onClose(path);
      };
      tabContainer.appendChild(closeBtn);
    }

    root.appendChild(tabContainer);
  }

  const addBtn = document.createElement("button");
  addBtn.className = "tab-add";
  addBtn.textContent = "+";
  addBtn.title = "Add new file";
  addBtn.onclick = onAdd;
  root.appendChild(addBtn);
}

export type AddFileResult = { ok: true } | { ok: false; error: string };

export interface NewFileInputOptions {
  root: HTMLElement;
  onConfirm: (rawName: string) => Promise<AddFileResult>;
}

export function showNewFileInput(opts: NewFileInputOptions): void {
  const { root, onConfirm } = opts;
  if (root.querySelector(".tab-new-file-input")) return;

  const container = document.createElement("div");
  container.className = "tab-new-file-input";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "filename.typ";
  input.className = "new-file-input";

  const errorEl = document.createElement("span");
  errorEl.className = "new-file-error";
  errorEl.hidden = true;

  const clearError = () => {
    input.classList.remove("invalid");
    errorEl.hidden = true;
    errorEl.textContent = "";
  };

  const showError = (message: string) => {
    input.classList.add("invalid");
    errorEl.textContent = message;
    errorEl.hidden = false;
  };

  input.addEventListener("input", clearError);

  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "Add";
  confirmBtn.className = "new-file-confirm";
  confirmBtn.onclick = async () => {
    const result = await onConfirm(input.value);
    if (result.ok) {
      container.remove();
    } else {
      showError(result.error);
      input.focus();
      input.select();
    }
  };

  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.className = "new-file-cancel";
  cancelBtn.onclick = () => container.remove();

  container.appendChild(input);
  container.appendChild(confirmBtn);
  container.appendChild(cancelBtn);
  container.appendChild(errorEl);
  root.appendChild(container);

  input.focus();
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") confirmBtn.click();
    if (e.key === "Escape") cancelBtn.click();
  });
}
