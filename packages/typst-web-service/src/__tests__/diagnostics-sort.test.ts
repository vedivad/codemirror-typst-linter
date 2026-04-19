import type { DiagnosticMessage } from "../types.js";
import { describe, expect, it } from "vitest";
import { sortDiagnosticsByFileAndRange } from "../diagnostics-sort.js";

const D1: DiagnosticMessage = {
  package: "",
  path: "/b.typ",
  severity: "Warning",
  range: { startLine: 4, startCol: 2, endLine: 4, endCol: 6 },
  message: "B",
};

const D2: DiagnosticMessage = {
  package: "",
  path: "/a.typ",
  severity: "Error",
  range: { startLine: 1, startCol: 8, endLine: 1, endCol: 10 },
  message: "A2",
};

const D3: DiagnosticMessage = {
  package: "",
  path: "/a.typ",
  severity: "Error",
  range: { startLine: 0, startCol: 1, endLine: 0, endCol: 2 },
  message: "A1",
};

describe("sortDiagnosticsByFileAndRange", () => {
  it("returns deterministic path/range ordering", () => {
    const sorted = sortDiagnosticsByFileAndRange([D1, D2, D3]);
    expect(sorted).toEqual([D3, D2, D1]);
  });

  it("does not mutate the original array", () => {
    const original = [D1, D2, D3];
    sortDiagnosticsByFileAndRange(original);
    expect(original).toEqual([D1, D2, D3]);
  });
});
