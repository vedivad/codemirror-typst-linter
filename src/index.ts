import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import type { DiagnosticMessage, WorkerRequest, WorkerResponse } from './types.js';

const DEFAULT_FONTS = [
  'https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-regular-webfont.ttf',
];

// Loaded from CDN by default so users need no bundler WASM config.
// Override with a local path (e.g. via new URL(..., import.meta.url)) for offline/perf.
const DEFAULT_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@0.7.0-rc2/pkg/typst_ts_web_compiler_bg.wasm';

export interface TypstLinterOptions {
  /** Font URLs to load into the Typst compiler. Defaults to Roboto from jsDelivr. */
  fonts?: string[];
  /**
   * URL to the typst-ts-web-compiler WASM binary.
   * Defaults to the matching version on jsDelivr CDN.
   * Override with a local asset URL for offline support or faster load:
   *   `new URL('@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm', import.meta.url).href`
   */
  wasmUrl?: string;
  /** Delay in ms before linting fires after a document change. Default: 0. */
  delay?: number;
  /** Include diagnostics from imported packages, not just the main file. Default: false. */
  includePackageDiagnostics?: boolean;
}

function parseRange(range: string): [number, number, number, number] {
  const m = range.match(/(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) return [0, 0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
}

function mapSeverity(raw: string): Diagnostic['severity'] {
  const s = raw.toLowerCase();
  if (s === 'warning') return 'warning';
  if (s === 'info') return 'info';
  return 'error';
}

function toCMDiagnostic(state: EditorState, d: DiagnosticMessage): Diagnostic {
  const [startLine, startCol, endLine, endCol] = parseRange(d.range);
  const docLines = state.doc.lines;

  // range from typst.ts 'full' format is 0-indexed; CM doc.line() is 1-indexed
  const fromLine = Math.min(startLine + 1, docLines);
  const toLine = Math.min(endLine + 1, docLines);

  let from = state.doc.line(fromLine).from + startCol;
  let to = state.doc.line(toLine).from + endCol;

  const len = state.doc.length;
  from = Math.max(0, Math.min(from, len));
  to = Math.max(from, Math.min(to, len));

  // Ensure the squiggle covers at least one character
  if (from === to && to < len) to += 1;

  return { from, to, severity: mapSeverity(d.severity), message: d.message, source: 'typst' };
}

function createWorker(): Worker {
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
}

function workerRpc(
  worker: Worker,
  request: WorkerRequest,
  timeoutMs = 30_000,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id === request.id) {
        clearTimeout(timer);
        worker.removeEventListener('message', handler);
        resolve(e.data);
      }
    };
    const timer = setTimeout(() => {
      worker.removeEventListener('message', handler);
      reject(new Error(`typstLinter: worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    worker.addEventListener('message', handler);
    worker.postMessage(request);
  });
}

class TypstWorkerPlugin {
  private worker: Worker;
  private ready: Promise<void>;
  private idCounter = 0;
  private latestId = 0;
  private includePackageDiagnostics: boolean;

  constructor(private options: {
    fonts: string[];
    wasmUrl: string;
    includePackageDiagnostics: boolean;
  }) {
    this.includePackageDiagnostics = options.includePackageDiagnostics;
    this.worker = createWorker();

    this.ready = workerRpc(
      this.worker,
      { type: 'init', id: ++this.idCounter, wasmUrl: options.wasmUrl, fonts: options.fonts },
      60_000,
    ).then(res => {
      if (res.type === 'error') throw new Error(`typstLinter worker init failed: ${res.message}`);
    });
  }

  async lint(view: EditorView): Promise<Diagnostic[]> {
    await this.ready;

    const id = ++this.idCounter;
    this.latestId = id;

    const source = view.state.doc.toString();
    const response = await workerRpc(this.worker, { type: 'compile', id, source });

    // Drop stale results
    if (id !== this.latestId) return [];

    if (response.type !== 'result') {
      if (response.type === 'error') {
        return [{
          from: 0,
          to: Math.min(1, view.state.doc.length),
          severity: 'error',
          message: response.message,
          source: 'typst',
        }];
      }
      return [];
    }

    return response.diagnostics
      .filter(d => this.includePackageDiagnostics || d.package === '')
      .map(d => toCMDiagnostic(view.state, d));
  }

  destroy() {
    const id = ++this.idCounter;
    workerRpc(this.worker, { type: 'destroy', id }, 5_000)
      .finally(() => this.worker.terminate());
  }
}

export function typstLinter(options: TypstLinterOptions = {}): Extension {
  const fonts = options.fonts ?? DEFAULT_FONTS;
  const wasmUrl = options.wasmUrl ?? DEFAULT_WASM_URL;
  const delay = options.delay ?? 0;
  const includePackageDiagnostics = options.includePackageDiagnostics ?? false;

  const workerPlugin = ViewPlugin.define(
    () => new TypstWorkerPlugin({ fonts, wasmUrl, includePackageDiagnostics }),
    {},
  );

  const linterExtension = linter(async (view) => {
    const plugin = view.plugin(workerPlugin);
    if (!plugin) return [];
    return plugin.lint(view);
  }, { delay });

  return [workerPlugin, linterExtension, lintGutter()];
}
