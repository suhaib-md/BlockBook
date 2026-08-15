/* ==========================================================================
   BlockBook — desktop.js
   The only module that knows Tauri exists.

   Every entry point works in three environments and must never throw in any of
   them: the built exe, a plain browser (`npm run dev`), and Node under the test
   harness. Tauri modules are therefore loaded with dynamic `import()` INSIDE a
   guard — a static import would break the browser build and every gate.
   docs/02-TRD.md §4
   ========================================================================== */

/**
 * True only inside the Tauri webview. `__TAURI_INTERNALS__` is injected by the
 * runtime; checking it costs nothing and is the officially supported probe.
 */
function isDesktop() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

/**
 * Copy text to the clipboard.
 *
 * Tauri's webview does not reliably expose `navigator.clipboard` without a
 * secure context, so the plugin is used there and the browser API is the
 * fallback. Returns a boolean rather than throwing: a failed copy is a toast,
 * not an exception.
 */
async function copyText(text) {
  if (isDesktop()) {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    } catch { /* fall through to the browser path */ }
  }

  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Last resort for non-secure browser contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Hide to tray. In a browser there is no window to hide, so this is a no-op. */
async function hideWindow() {
  if (!isDesktop()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
    return true;
  } catch { return false; }
}

/** Toggle always-on-top. Persisted in settings; applied here. */
async function setAlwaysOnTop(on) {
  if (!isDesktop()) return false;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(Boolean(on));
    return true;
  } catch { return false; }
}

/**
 * Run `fn` whenever the window is summoned (hotkey or tray).
 *
 * Rust shows the window but cannot focus an element inside the webview, so it
 * emits an event and the frontend does the focusing. That is what makes
 * "Ctrl+Space, type, read" work without touching the mouse.
 */
async function onWindowShown(fn) {
  if (!isDesktop()) return () => {};
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return await listen("blockbook://shown", () => fn());
  } catch { return () => {}; }
}

export {
  isDesktop,
  copyText,
  hideWindow,
  setAlwaysOnTop,
  onWindowShown,
};
