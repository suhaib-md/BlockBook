/*!
BlockBook — Tauri shell.

Phase 9 adds the overlay behaviour that makes the app usable *during* play:
always-on-top, a `Ctrl+Space` global summon, a tray icon, and close-to-tray.
Window position/size persistence comes from the window-state plugin.

File-backed storage is still Phase 10 — deliberately not here, so a regression
stays attributable to one change. docs/06-IMPLEMENTATION-PLAN.md
*/

// Emitter is what provides `.emit()` on a window in Tauri 2 — it is a trait,
// so it must be in scope even though nothing names it directly.
use tauri::{Emitter, Manager, WindowEvent};

#[cfg(desktop)]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
};

/// The window label, matched by `capabilities/default.json`.
const MAIN: &str = "main";

/// Event the frontend listens for so it can focus and select the search box.
const SHOWN_EVENT: &str = "blockbook://shown";

/// Bring the window up and tell the frontend to focus search.
#[cfg(desktop)]
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        // The webview owns focus inside itself; Rust cannot focus an input.
        let _ = w.emit(SHOWN_EVENT, ());
    }
}

#[cfg(desktop)]
fn hide_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.hide();
    }
}

/// Ctrl+Space behaviour: visible -> hide, hidden -> show and focus.
#[cfg(desktop)]
fn toggle_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        match w.is_visible() {
            Ok(true) => hide_main(app),
            _ => show_main(app),
        }
    }
}

#[cfg(desktop)]
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &sep, &quit])?;

    TrayIconBuilder::with_id("blockbook-tray")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("BlockBook — Ctrl+Space to summon")
        .menu(&menu)
        // Left-click the tray icon toggles, matching the hotkey.
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "hide" => hide_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::ShortcutState;

        builder = builder
            // Restores the window position and size from the previous launch.
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        // Fire on press only — otherwise the release toggles it back.
                        if event.state() == ShortcutState::Pressed {
                            toggle_main(app);
                        }
                    })
                    .build(),
            );
    }

    builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                // Registration can fail if another app already owns the combo.
                // That is not fatal: the tray and the window still work.
                if let Err(e) = app.global_shortcut().register("CmdOrCtrl+Space") {
                    eprintln!("BlockBook: could not register Ctrl+Space ({e}). \
                               Another application may already use it.");
                }

                build_tray(app.handle())?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing hides to tray instead of quitting. Quit lives in the tray
            // menu. docs/03-APP-FLOW.md §2.3
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running BlockBook");
}
