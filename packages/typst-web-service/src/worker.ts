import {
  createTypstCompiler,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts/compiler";

import {
  loadFonts,
  withPackageRegistry,
  withAccessModel,
} from "@myriaddreamin/typst.ts/options.init";

import { FetchPackageRegistry } from "@myriaddreamin/typst.ts/fs/package";
import { MemoryAccessModel } from "@myriaddreamin/typst.ts/fs/memory";

import type { WorkerRequest, WorkerResponse, DiagnosticMessage } from "./types.js";

// typst-ts-web-compiler format enum: 1 = PDF
const PDF_FORMAT = 1;

const accessModel = new MemoryAccessModel();
const packageRegistry = new FetchPackageRegistry(accessModel);

let compiler: TypstCompiler | null = null;

async function initCompiler(wasmUrl: string, fontUrls: string[], packages: boolean): Promise<void> {
  compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => wasmUrl,
    beforeBuild: [
      loadFonts(fontUrls),
      ...(packages ? [withAccessModel(accessModel), withPackageRegistry(packageRegistry)] : []),
    ],
  });
}

function parseRange(range: string): DiagnosticMessage["range"] | null {
  const m = range.match(/(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) {
    console.warn(`[typst-web-service] Skipping diagnostic with unrecognized range format: ${JSON.stringify(range)}`);
    return null;
  }
  return { startLine: +m[1], startCol: +m[2], endLine: +m[3], endCol: +m[4] };
}

async function compile(source: string): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }> {
  if (!compiler) throw new Error("Compiler not initialized");
  compiler.addSource("/main.typ", source);
  const result = await compiler.compile({ mainFilePath: "/main.typ", diagnostics: "full" });
  const diagnostics: DiagnosticMessage[] = (result.diagnostics ?? []).flatMap((d) => {
    const range = parseRange(d.range);
    if (!range) return [];
    return [{ ...d, severity: d.severity as DiagnosticMessage["severity"], range }];
  });
  return { diagnostics, vector: result.result ?? undefined };
}

function postError(id: number, err: unknown): void {
  self.postMessage({
    type: "error",
    id,
    message: err instanceof Error ? err.message : String(err),
  } satisfies WorkerResponse);
}

function transferBuffer(data: Uint8Array): ArrayBuffer {
  // data.buffer is ArrayBuffer in a Worker context (not SharedArrayBuffer)
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
}

// Yield to the event loop so queued messages get processed before we start work.
const yieldToEventLoop = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Compile coalescing ---
// Fast typing queues multiple compile requests. Since WASM execution blocks
// the worker thread, we coalesce: before starting a compile, yield to the
// event loop. If a newer request arrived, skip the old one.

type CompileRequest = Extract<WorkerRequest, { type: "compile" }>;
type RenderRequest = Extract<WorkerRequest, { type: "render" }>;

function makeQueue<T extends { id: number }>(handle: (req: T) => Promise<void>): (req: T) => void {
  let pending: T | null = null;
  let processing = false;

  async function drain(): Promise<void> {
    processing = true;
    while (pending) {
      const req = pending;
      pending = null;
      await yieldToEventLoop();
      if (pending) {
        self.postMessage({ type: "cancelled", id: req.id } satisfies WorkerResponse);
        continue;
      }
      await handle(req);
    }
    processing = false;
  }

  return (req: T) => {
    pending = req;
    if (!processing) drain();
  };
}

const enqueueCompile = makeQueue<CompileRequest>(async (req) => {
  try {
    const { diagnostics, vector: vectorData } = await compile(req.source);
    const vector = vectorData ? transferBuffer(vectorData) : undefined;
    const msg: WorkerResponse = { type: "result", id: req.id, diagnostics, vector };
    self.postMessage(msg, vector ? [vector] : []);
  } catch (err) {
    postError(req.id, err);
  }
});

const enqueueRender = makeQueue<RenderRequest>(async (req) => {
  try {
    if (!compiler) throw new Error("Compiler not initialized");
    compiler.addSource("/main.typ", req.source);
    const result = await compiler.compile({
      mainFilePath: "/main.typ",
      format: PDF_FORMAT,
      diagnostics: "none",
    } as Parameters<typeof compiler.compile>[0]);
    if (!result.result) throw new Error("Compilation produced no output");
    const data = transferBuffer(result.result);
    self.postMessage({ type: "pdf", id: req.id, data } satisfies WorkerResponse, [data]);
  } catch (err) {
    postError(req.id, err);
  }
});

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === "init") {
    try {
      await initCompiler(req.wasmUrl, req.fonts, req.packages);
      self.postMessage({ type: "ready", id: req.id } satisfies WorkerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "compile") { enqueueCompile(req); return; }
  if (req.type === "render") { enqueueRender(req); return; }

  if (req.type === "destroy") {
    self.postMessage({ type: "destroyed", id: req.id } satisfies WorkerResponse);
  }
};
