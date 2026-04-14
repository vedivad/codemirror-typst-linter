import {
  CompileFormatEnum,
  createTypstCompiler,
  type TypstCompiler,
} from "@myriaddreamin/typst.ts/compiler";
import { MemoryAccessModel } from "@myriaddreamin/typst.ts/fs/memory";

import { FetchPackageRegistry } from "@myriaddreamin/typst.ts/fs/package";
import {
  loadFonts,
  withAccessModel,
  withPackageRegistry,
} from "@myriaddreamin/typst.ts/options.init";

import { makeQueue } from "./queue.js";
import type {
  DiagnosticMessage,
  WorkerRequest,
  WorkerResponse,
} from "./types.js";
import { postError } from "./worker-utils.js";

const MAIN_FILE = "/main.typ";

const accessModel = new MemoryAccessModel();
const packageRegistry = new FetchPackageRegistry(accessModel);

let compiler: TypstCompiler | null = null;

async function initCompiler(
  wasmUrl: string,
  fontUrls: string[],
  packages: boolean,
): Promise<void> {
  compiler = createTypstCompiler();
  await compiler.init({
    getModule: () => wasmUrl,
    beforeBuild: [
      loadFonts(fontUrls),
      ...(packages
        ? [withAccessModel(accessModel), withPackageRegistry(packageRegistry)]
        : []),
    ],
  });
}

function parseRange(range: string): DiagnosticMessage["range"] | null {
  const m = range.match(/(\d+):(\d+)-(\d+):(\d+)/);
  if (!m) {
    console.warn(
      `[typst-web-service] Skipping diagnostic with unrecognized range format: ${JSON.stringify(range)}`,
    );
    return null;
  }
  return { startLine: +m[1], startCol: +m[2], endLine: +m[3], endCol: +m[4] };
}

function addSources(files: Record<string, string>): void {
  if (!compiler) throw new Error("Compiler not initialized");
  for (const [path, source] of Object.entries(files)) {
    compiler.addSource(path, source);
  }
}

async function compile(
  files: Record<string, string>,
): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }> {
  addSources(files);
  const result = await compiler!.compile({
    mainFilePath: MAIN_FILE,
    diagnostics: "full",
  });
  const diagnostics: DiagnosticMessage[] = (result.diagnostics ?? []).flatMap(
    (d) => {
      const range = parseRange(d.range);
      if (!range) return [];
      return [
        { ...d, severity: d.severity as DiagnosticMessage["severity"], range },
      ];
    },
  );
  return { diagnostics, vector: result.result ?? undefined };
}

function transferBuffer(data: Uint8Array): ArrayBuffer {
  // data.buffer is ArrayBuffer in a Worker context (not SharedArrayBuffer)
  return (data.buffer as ArrayBuffer).slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  );
}

type CompileRequest = Extract<WorkerRequest, { type: "compile" }>;
type RenderRequest = Extract<WorkerRequest, { type: "render" }>;

function postCancelled(req: { id: number }): void {
  self.postMessage({
    type: "cancelled",
    id: req.id,
  } satisfies WorkerResponse);
}

const enqueueCompile = makeQueue<CompileRequest>(async (req) => {
  try {
    const { diagnostics, vector: vectorData } = await compile(req.files);
    const vector = vectorData ? transferBuffer(vectorData) : undefined;
    const msg: WorkerResponse = {
      type: "result",
      id: req.id,
      diagnostics,
      vector,
    };
    self.postMessage(msg, vector ? [vector] : []);
  } catch (err) {
    postError(req.id, err);
  }
}, postCancelled);

const enqueueRender = makeQueue<RenderRequest>(async (req) => {
  try {
    addSources(req.files);
    const result = await compiler!.compile({
      mainFilePath: MAIN_FILE,
      format: CompileFormatEnum.pdf,
      diagnostics: "none",
    });
    if (!result.result) throw new Error("Compilation produced no output");
    const data = transferBuffer(result.result);
    self.postMessage(
      { type: "pdf", id: req.id, data } satisfies WorkerResponse,
      [data],
    );
  } catch (err) {
    postError(req.id, err);
  }
}, postCancelled);

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

  if (req.type === "compile") {
    enqueueCompile(req);
    return;
  }
  if (req.type === "render") {
    enqueueRender(req);
    return;
  }

  if (req.type === "destroy") {
    self.postMessage({
      type: "destroyed",
      id: req.id,
    } satisfies WorkerResponse);
  }
};
