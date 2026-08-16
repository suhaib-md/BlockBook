/*!
Native file pickers for export and import.

Deliberately implemented as two narrow commands rather than exposing a general
filesystem plugin to the webview. The app only ever needs to write one JSON file
the user picked, and read one JSON file the user picked — granting broad `fs:`
scope to achieve that would widen the attack surface for no benefit.
docs/02-TRD.md §1 (P1), and the capability file stays free of `fs:` entries.
*/

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, FilePath};

fn to_path(f: FilePath) -> Option<std::path::PathBuf> {
    f.into_path().ok()
}

/// Save-as dialog, then write. Returns the chosen path, or `None` if cancelled.
#[tauri::command]
pub fn export_dialog(
    app: AppHandle,
    default_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Export BlockBook data")
        .set_file_name(&default_name)
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    let Some(path) = picked.and_then(to_path) else {
        return Ok(None); // cancelled — not an error
    };

    std::fs::write(&path, contents.as_bytes())
        .map_err(|e| format!("Could not write {}: {e}", path.display()))?;

    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Open dialog, then read. Returns the file's contents, or `None` if cancelled.
/// Nothing is parsed here — validation belongs to the frontend, which already
/// refuses anything that is not a BlockBook export.
#[tauri::command]
pub fn import_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Import BlockBook data")
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    let Some(path) = picked.and_then(to_path) else {
        return Ok(None);
    };

    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {}: {e}", path.display()))
}
