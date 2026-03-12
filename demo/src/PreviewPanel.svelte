<script lang="ts">
  interface Props {
    svgContent: string | null;
    error: string | null;
  }

  let { svgContent, error }: Props = $props();
</script>

<div class="preview">
  {#if error}
    <div class="error">{error}</div>
  {:else if svgContent}
    <div class="svg-container">{@html svgContent}</div>
  {:else}
    <div class="placeholder">Rendering…</div>
  {/if}
</div>

<style>
  .preview {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-left: 1px solid #333;
    background: #fff;
  }

  .svg-container {
    flex: 1;
    overflow: auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 1rem;
  }

  :global(.svg-container svg) {
    max-width: 100%;
    height: auto;
  }

  .error {
    padding: 1rem;
    color: #ff6b6b;
    font-size: 0.8rem;
    font-family: monospace;
    white-space: pre-wrap;
    background: #1a1a2e;
    height: 100%;
    overflow: auto;
  }

  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #888;
    font-size: 0.85rem;
    background: #1a1a2e;
  }
</style>
