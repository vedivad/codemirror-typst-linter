import { describe, it } from "vitest";

// createBlobWorker / createWorker / createAnalyzerWorker rely on browser
// globals (Blob, URL.createObjectURL, Worker) that are not available in the
// Vitest node environment. They are covered by end-to-end usage in the demo.
describe("rpc", () => {
  it.todo("blob worker creation covered by demo e2e");
});
