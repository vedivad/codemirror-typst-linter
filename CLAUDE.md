# CLAUDE.md

## Project Overview

Monorepo containing two packages for Typst compilation and editing:

- **typst-web-service** — Editor-agnostic Typst compilation service running in a Web Worker. Handles WASM compiler lifecycle, RPC, request coalescing, and `@preview/` package fetching.
- **codemirror-typst** — CodeMirror 6 extension that wraps the service for real-time diagnostics.

## Tech Stack

- **Language:** TypeScript (strict mode, ES2020 target, ESNext modules)
- **Package manager:** Bun (workspaces: `packages/*` + `demo/`)
- **Build:** tsup (esbuild-based), service package inlines worker via `__WORKER_CODE__` define
- **Demo:** Svelte 5 + Vite 7

## Commands

```bash
# Full build (service first, then codemirror — order matters)
make build

# Dev server (builds + runs demo)
make dev

# Individual packages
cd packages/typst-web-service && bun run build
cd packages/codemirror-typst && bun run build

# No test suite or linter configured
```

## Architecture

```
packages/
  typst-web-service/     → npm: typst-web-service
    src/
      index.ts           — Barrel exports
      service.ts         — TypstService class (worker lifecycle, compile/render RPC)
      worker.ts          — Web Worker implementation (compile, request coalescing)
      rpc.ts             — Worker RPC utilities, blob worker creation
      types.ts           — Worker protocol types
  codemirror-typst/      → npm: codemirror-typst (depends on typst-web-service)
    src/
      index.ts           — Public API (typstLinter(), re-exports TypstService)
      plugin.ts          — TypstWorkerPlugin (CodeMirror ViewPlugin)
      diagnostics.ts     — Typst → CodeMirror diagnostic conversion
demo/                    → Svelte 5 demo app using both packages
```

## Key Patterns

- **Request coalescing** in worker: yields to event loop, cancels stale compile requests
- **RPC with timeouts:** 30s default, 60s for init/render
- **Service ownership:** `typstLinter()` can auto-create or accept an external `TypstService`
- **Build order matters:** codemirror-typst needs typst-web-service built first (for .d.ts)
- **Private fields:** uses `#field` syntax
- **Svelte 5:** demo uses `$state` reactive declarations
