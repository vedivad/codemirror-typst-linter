<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorView, basicSetup } from 'codemirror';
  import { EditorState } from '@codemirror/state';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { typst } from 'codemirror-lang-typst';
  import { typstLinter } from 'codemirror-typst-linter';

  const initialDoc = `\
// Try introducing errors below — squiggles appear instantly.
#let greeting(name) = [Hello, #name!]

#greeting("World")

// Uncomment to see a type error:
// #let x = 1 + "oops"
`;

  let container: HTMLDivElement;

  onMount(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          basicSetup,
          oneDark,
          typst(),
          typstLinter(),
        ],
      }),
      parent: container,
    });

    return () => view.destroy();
  });
</script>

<div class="layout">
  <header>
    <h1>codemirror-typst-linter</h1>
    <p>Typst diagnostics with incremental compilation. Edit the document to see errors highlighted in real time.</p>
  </header>
  <div class="editor" bind:this={container}></div>
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

  p {
    margin: 0;
    font-size: 0.85rem;
    color: #888;
  }

  .editor {
    flex: 1;
    overflow: hidden;
  }

  :global(.editor .cm-editor) {
    height: 100%;
  }

  :global(.editor .cm-scroller) {
    overflow: auto;
    font-family: 'Fira Code', 'Cascadia Code', ui-monospace, monospace;
    font-size: 14px;
  }
</style>
