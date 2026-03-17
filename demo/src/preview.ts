import initRenderer, { TypstRendererBuilder, type TypstRenderer } from '@myriaddreamin/typst-ts-renderer';
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url';

let renderer: TypstRenderer | null = null;

export function applyVector(el: HTMLElement, vector: Uint8Array) {
  if (!renderer) return;
  const session = renderer.create_session();
  try {
    renderer.manipulate_data(session, 'reset', vector);
    el.innerHTML = `<div class="svg-container">${renderer.svg_data(session)}</div>`;
  } catch (err) {
    el.innerHTML = `<div class="error">${err instanceof Error ? err.message : String(err)}</div>`;
  } finally {
    session.free();
  }
}

export async function initPreview(el: HTMLElement) {
  try {
    await initRenderer(rendererWasmUrl);
    renderer = await new TypstRendererBuilder().build();
  } catch (err) {
    el.innerHTML = `<div class="error">${err instanceof Error ? err.message : String(err)}</div>`;
  }
}
