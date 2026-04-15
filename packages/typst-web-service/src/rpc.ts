// Injected at build time by tsup (see tsup.config.ts)
declare const __WORKER_CODE__: string;
declare const __ANALYZER_WORKER_CODE__: string;

/** Create a Worker from an inlined code string, auto-revoking the blob URL on terminate. */
export function createBlobWorker(code: string): Worker {
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  const origTerminate = worker.terminate.bind(worker);
  worker.terminate = () => {
    origTerminate();
    URL.revokeObjectURL(url);
  };
  return worker;
}

/** Create a blob Worker from the inlined compiler worker code. */
export function createWorker(): Worker {
  return createBlobWorker(__WORKER_CODE__);
}

/** Create a blob Worker from the inlined analyzer worker code. */
export function createAnalyzerWorker(): Worker {
  return createBlobWorker(__ANALYZER_WORKER_CODE__);
}
