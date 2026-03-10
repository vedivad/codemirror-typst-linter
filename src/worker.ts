import { createTypstCompiler } from '@myriaddreamin/typst.ts/compiler';
import type { WorkerRequest, WorkerResponse, DiagnosticMessage } from './types.js';

interface TypstCompiler {
  init(options: unknown): Promise<void>;
  addSource(path: string, source: string): void;
  withIncrementalServer<T>(f: (server: IncrementalServer) => Promise<T>): Promise<T>;
  compile(options: unknown): Promise<{ diagnostics?: DiagnosticMessage[] }>;
}

interface IncrementalServer {
  reset(): void;
  current(): Uint8Array | undefined;
}

interface FontBuilder {
  add_raw_font(buffer: Uint8Array): Promise<void>;
}

let compiler: TypstCompiler | null = null;
let incrServer: IncrementalServer | null = null;
let shutdownResolve: (() => void) | null = null;

async function initCompiler(wasmUrl: string, fontUrls: string[]): Promise<void> {
  const fontBuffers = await Promise.all(
    fontUrls.map(url =>
      fetch(url).then(r => r.arrayBuffer()).then(buf => new Uint8Array(buf))
    )
  );

  compiler = createTypstCompiler() as unknown as TypstCompiler;
  await compiler.init({
    getModule: () => wasmUrl,
    beforeBuild: [
      async (_: unknown, { builder }: { builder: FontBuilder }) => {
        for (const buf of fontBuffers) {
          await builder.add_raw_font(buf);
        }
      },
    ],
  });

  // Keep the IncrementalServer alive for the lifetime of this worker
  const serverReady = new Promise<IncrementalServer>(resolve => {
    const shutdownSignal = new Promise<void>(r => { shutdownResolve = r; });

    compiler!.withIncrementalServer(async (server) => {
      resolve(server);
      await shutdownSignal;
    });
  });

  incrServer = await serverReady;
}

async function compile(source: string): Promise<DiagnosticMessage[]> {
  if (!compiler || !incrServer) throw new Error('Compiler not initialized');

  compiler.addSource('/main.typ', source);

  const result = await compiler.compile({
    mainFilePath: '/main.typ',
    incrementalServer: incrServer,
    diagnostics: 'full',
  });

  return result.diagnostics ?? [];
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.type === 'init') {
    try {
      await initCompiler(req.wasmUrl, req.fonts);
      self.postMessage({ type: 'ready', id: req.id } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (req.type === 'compile') {
    try {
      const diagnostics = await compile(req.source);
      self.postMessage({ type: 'result', id: req.id, diagnostics } satisfies WorkerResponse);
    } catch (err) {
      self.postMessage({
        type: 'error',
        id: req.id,
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse);
    }
    return;
  }

  if (req.type === 'destroy') {
    shutdownResolve?.();
    self.postMessage({ type: 'ready', id: req.id } satisfies WorkerResponse);
  }
};
