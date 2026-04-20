import * as Comlink from "comlink";
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
import { sortDiagnosticsByFileAndRange } from "./diagnostics-sort.js";
import type { DiagnosticMessage } from "./types.js";

const MAIN_FILE = "/main.typ";

class CompilerWorker {
  private compiler: TypstCompiler | null = null;
  private readonly accessModel = new MemoryAccessModel();
  private readonly packageRegistry: FetchPackageRegistry;

  constructor() {
    this.packageRegistry = new FetchPackageRegistry(this.accessModel);
  }

  async init(
    wasmUrl: string,
    fontUrls: string[],
    packages: boolean,
  ): Promise<void> {
    this.compiler = createTypstCompiler();
    await this.compiler.init({
      getModule: () => wasmUrl,
      beforeBuild: [
        loadFonts(fontUrls),
        ...(packages
          ? [
              withAccessModel(this.accessModel),
              withPackageRegistry(this.packageRegistry),
            ]
          : []),
      ],
    });
  }

  async compile(
    entry?: string,
  ): Promise<{ diagnostics: DiagnosticMessage[]; vector?: Uint8Array }> {
    if (!this.compiler) throw new Error("Compiler not initialized");
    const result = await this.compiler.compile({
      mainFilePath: entry ?? MAIN_FILE,
      diagnostics: "full",
    });
    const diagnostics = sortDiagnosticsByFileAndRange(
      (result.diagnostics ?? []).flatMap((d) => {
        const m = d.range.match(/(\d+):(\d+)-(\d+):(\d+)/);
        if (!m) {
          console.warn(
            `[typst-web-service] Skipping diagnostic with unrecognized range format: ${JSON.stringify(d.range)}`,
          );
          return [];
        }
        return [
          {
            ...d,
            severity: d.severity as DiagnosticMessage["severity"],
            range: {
              startLine: +m[1],
              startCol: +m[2],
              endLine: +m[3],
              endCol: +m[4],
            },
          },
        ];
      }),
    );
    const vector = result.result ?? undefined;
    if (vector) {
      return Comlink.transfer({ diagnostics, vector }, [
        vector.buffer as ArrayBuffer,
      ]);
    }
    return { diagnostics };
  }

  async compilePdf(entry?: string): Promise<Uint8Array> {
    if (!this.compiler) throw new Error("Compiler not initialized");
    const result = await this.compiler.compile({
      mainFilePath: entry ?? MAIN_FILE,
      format: CompileFormatEnum.pdf,
      diagnostics: "none",
    });
    if (!result.result) throw new Error("Compilation produced no output");
    return Comlink.transfer(result.result, [
      result.result.buffer as ArrayBuffer,
    ]);
  }

  mapShadow(path: string, content: Uint8Array): void {
    if (!this.compiler) throw new Error("Compiler not initialized");
    this.compiler.mapShadow(path, content);
  }

  mapShadowMany(files: Record<string, Uint8Array>): void {
    if (!this.compiler) throw new Error("Compiler not initialized");
    for (const [path, content] of Object.entries(files)) {
      this.compiler.mapShadow(path, content);
    }
  }

  unmapShadow(path: string): void {
    if (!this.compiler) throw new Error("Compiler not initialized");
    this.compiler.unmapShadow(path);
  }

  resetShadow(): void {
    if (!this.compiler) throw new Error("Compiler not initialized");
    this.compiler.resetShadow();
  }

  destroy(): void {
    this.compiler = null;
  }
}

Comlink.expose(new CompilerWorker());
