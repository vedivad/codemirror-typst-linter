import type { WorkerRequest, WorkerResponse } from "./types.js";

// Injected at build time by tsup (see tsup.config.ts)
declare const __WORKER_CODE__: string;

export function createWorker(): Worker {
  const blob = new Blob([__WORKER_CODE__], { type: "application/javascript" });
  // Blob URL is intentionally not revoked — it must remain valid for the Worker's lifetime
  return new Worker(URL.createObjectURL(blob));
}

export function workerRpc(
  worker: Worker,
  request: WorkerRequest,
  timeoutMs = 30_000,
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const handler = (e: MessageEvent<WorkerResponse>) => {
      if (e.data.id !== request.id) return;
      clearTimeout(timer);
      worker.removeEventListener("message", handler);
      resolve(e.data);
    };
    const timer = setTimeout(() => {
      worker.removeEventListener("message", handler);
      reject(new Error(`typst worker timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    worker.addEventListener("message", handler);
    worker.postMessage(request);
  });
}
