import init, { TinymistLanguageServer } from "tinymist-web";
import type {
  AnalyzerDiagnosticEvent,
  AnalyzerRequest,
  AnalyzerResponse,
  LspDiagnostic,
} from "./analyzer-types.js";
import { postError } from "./worker-utils.js";

let server: TinymistLanguageServer | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- events are opaque values from WASM
const events: any[] = [];

function normalizeUri(uri: string): string {
  return uri.startsWith("untitled:/")
    ? `untitled:${uri.slice("untitled:/".length)}`
    : uri;
}

function flushEvents(): void {
  if (!server) return;
  while (events.length > 0) {
    for (const event of events.splice(0)) {
      server.on_event(event);
    }
  }
}

async function initServer(wasmUrl: string): Promise<void> {
  await init(wasmUrl);

  server = new TinymistLanguageServer({
    sendEvent: (event: any): void => void events.push(event),
    sendRequest({ id }: { id: number; method: string; params: unknown }): void {
      server!.on_response({ id, result: null });
    },
    sendNotification: ({
      method,
      params,
    }: {
      method: string;
      params: unknown;
    }): void => {
      if (method === "textDocument/publishDiagnostics") {
        const { uri, diagnostics } = params as {
          uri: string;
          diagnostics: LspDiagnostic[];
        };
        // Push diagnostics to main thread as an unsolicited notification (no id).
        self.postMessage({
          type: "diagnostics",
          uri: normalizeUri(uri),
          diagnostics,
        } satisfies AnalyzerDiagnosticEvent);
      }
    },
    resolveFn: () => undefined,
  });

  const initResult = server.on_request("initialize", {
    capabilities: {
      textDocument: {
        publishDiagnostics: { relatedInformation: true },
        completion: { completionItem: { snippetSupport: true } },
        hover: { contentFormat: ["markdown", "plaintext"] },
      },
    },
    rootUri: "file:///",
  });

  if (initResult && typeof initResult === "object" && "then" in initResult) {
    await initResult;
  }

  flushEvents();
  server.on_notification("initialized", {});
  flushEvents();
}

self.onmessage = async (e: MessageEvent<AnalyzerRequest>) => {
  const req = e.data;

  if (req.type === "init") {
    try {
      await initServer(req.wasmUrl);
      self.postMessage({
        type: "ready",
        id: req.id,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (!server) {
    postError(req.id, new Error("Analyzer not initialized"));
    return;
  }

  if (req.type === "didOpen") {
    try {
      server.on_notification("textDocument/didOpen", {
        textDocument: {
          uri: req.uri,
          languageId: "typst",
          version: 1,
          text: req.content,
        },
      });
      flushEvents();
      self.postMessage({ type: "ack", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "didClose") {
    try {
      server.on_notification("textDocument/didClose", {
        textDocument: { uri: req.uri },
      });
      flushEvents();
      self.postMessage({ type: "ack", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "didChange") {
    try {
      server.on_notification("textDocument/didChange", {
        textDocument: { uri: req.uri, version: req.version },
        contentChanges: [{ text: req.content }],
      });
      flushEvents();
      // Diagnostics will arrive asynchronously via publishDiagnostics → AnalyzerDiagnosticEvent.
      self.postMessage({ type: "ack", id: req.id } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "completion") {
    try {
      const result = server.on_request("textDocument/completion", {
        textDocument: { uri: req.uri },
        position: { line: req.line, character: req.character },
      });
      const resolved =
        result && typeof result === "object" && "then" in result
          ? await result
          : result;
      flushEvents();
      self.postMessage({
        type: "completionResult",
        id: req.id,
        result: resolved ?? null,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "hover") {
    try {
      const result = server.on_request("textDocument/hover", {
        textDocument: { uri: req.uri },
        position: { line: req.line, character: req.character },
      });
      const resolved =
        result && typeof result === "object" && "then" in result
          ? await result
          : result;
      flushEvents();
      self.postMessage({
        type: "hoverResult",
        id: req.id,
        result: resolved ?? null,
      } satisfies AnalyzerResponse);
    } catch (err) {
      postError(req.id, err);
    }
    return;
  }

  if (req.type === "destroy") {
    server.free();
    server = null;
    self.postMessage({
      type: "destroyed",
      id: req.id,
    } satisfies AnalyzerResponse);
  }
};
