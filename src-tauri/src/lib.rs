/*!
BlockBook — Tauri shell.

Phase 8 deliberately does nothing but open a window. Overlay behaviour
(always-on-top, the Ctrl+Space global shortcut, the tray icon, close-to-tray)
is Phase 9, and file-backed storage is Phase 10. Keeping those in separate
commits is what makes a regression attributable.
docs/06-IMPLEMENTATION-PLAN.md
*/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running BlockBook");
}
