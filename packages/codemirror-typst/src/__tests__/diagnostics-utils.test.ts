import type { DiagnosticMessage } from "@vedivad/typst-web-service";
import { describe, expect, it } from "vitest";
import {
  diagnosticLocation,
  groupDiagnosticsByFile,
} from "../diagnostics-utils.js";

const DIAG_A: DiagnosticMessage = {
  package: "",
  path: "/b.typ",
  severity: "Warning",
  range: { startLine: 4, startCol: 2, endLine: 4, endCol: 6 },
  message: "B",
};

const DIAG_B: DiagnosticMessage = {
  package: "",
  path: "/a.typ",
  severity: "Error",
  range: { startLine: 1, startCol: 8, endLine: 1, endCol: 10 },
  message: "A2",
};

const DIAG_C: DiagnosticMessage = {
  package: "",
  path: "/a.typ",
  severity: "Error",
  range: { startLine: 0, startCol: 1, endLine: 0, endCol: 2 },
  message: "A1",
};

describe("diagnostics-utils", () => {
  it("groups diagnostics by file path", () => {
    const grouped = groupDiagnosticsByFile([DIAG_A, DIAG_B, DIAG_C]);
    expect(Object.keys(grouped).sort()).toEqual(["/a.typ", "/b.typ"]);
    expect(grouped["/a.typ"]).toEqual([DIAG_B, DIAG_C]);
    expect(grouped["/b.typ"]).toEqual([DIAG_A]);
  });

  it("returns 1-based diagnostic location", () => {
    expect(diagnosticLocation(DIAG_A)).toEqual({
      path: "/b.typ",
      line: 5,
      col: 3,
    });
  });
});
