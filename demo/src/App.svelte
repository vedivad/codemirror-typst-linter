<script lang="ts">
  import { onMount } from 'svelte';
  import Editor from './Editor.svelte';
  import DiagnosticsPanel from './DiagnosticsPanel.svelte';
  import PreviewPanel from './PreviewPanel.svelte';
  import { TypstService } from 'codemirror-typst-linter';
  import type { Diagnostic } from '@codemirror/lint';
  import initRenderer, { TypstRendererBuilder, type TypstRenderer } from '@myriaddreamin/typst-ts-renderer';
  import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';

  const initialDoc = `\
// Package imports are fetched on demand from packages.typst.org.
// Try introducing errors — squiggles appear instantly.
#import "@preview/cetz:0.3.4": canvas, draw

#canvas({
  draw.circle((0, 0), radius: 1)
  draw.line((0, 0), (1, 0))
})

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

  let diagnostics = $state<Diagnostic[]>([]);
  let svgContent = $state<string | null>(null);
  let renderError = $state<string | null>(null);
  let ready = $state(false);
  let service: TypstService | null = null;
  let renderer: TypstRenderer | null = null;

  onMount(async () => {
    const s = new TypstService(
      new Worker(new URL('codemirror-typst-linter/worker', import.meta.url), { type: 'module' }),
    );
    service = s;

    try {
      await initRenderer(rendererWasmUrl);
      const builder = new TypstRendererBuilder();
      renderer = await builder.build();
    } catch (err) {
      renderError = err instanceof Error ? err.message : String(err);
    }

    ready = true;

    return () => { s.destroy(); };
  });

  function applyVector(vector: Uint8Array) {
    if (!renderer) return;
    const session = renderer.create_session();
    try {
      renderer.manipulate_data(session, 'reset', vector);
      svgContent = renderer.svg_data(session);
      renderError = null;
    } catch (err) {
      renderError = err instanceof Error ? err.message : String(err);
    } finally {
      session.free();
    }
  }
</script>

<div class="layout">
  <header>
    <h1>codemirror-typst-linter</h1>
    <p>Typst diagnostics with incremental compilation and @preview/ package support.</p>
  </header>
  <div class="main">
    {#if ready && service}
      <Editor
        {initialDoc}
        {service}
        onDiagnostics={(d) => { diagnostics = d; }}
        onVector={applyVector}
      />
    {/if}
    <DiagnosticsPanel {diagnostics} />
    <PreviewPanel {svgContent} error={renderError} />
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: system-ui, sans-serif;
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .layout {
    display: flex;
    flex-direction: column;
    height: 100dvh;
  }

  header {
    padding: 1rem 1.5rem 0.75rem;
    border-bottom: 1px solid #333;
  }

  h1 {
    margin: 0 0 0.25rem;
    font-size: 1.1rem;
    font-family: monospace;
    color: #7ecfff;
  }

  header p {
    margin: 0;
    font-size: 0.85rem;
    color: #888;
  }

  .main {
    flex: 1;
    display: flex;
    overflow: hidden;
  }
</style>
