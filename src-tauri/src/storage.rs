/*!
File-backed storage: portable `data.json`, atomic writes, rolling backups.

This lives in Rust rather than the webview because the guarantees are real here
— `fs::rename` is an atomic replace at the filesystem level, and a crash mid
write leaves the previous file untouched. docs/02-TRD.md §5.3, ADR-008.

R-01 (data loss) is the highest-severity risk in the register. Every function
below is written so that a failure loses nothing: the old file survives until a
complete new one is in place, and nothing unreadable is ever overwritten.
*/

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const FILE: &str = "data.json";
const TMP: &str = "data.json.tmp";
const BACKUP_DIR: &str = "backups";
const KEEP_BACKUPS: usize = 20;

#[derive(Serialize, Clone)]
pub struct StorageInfo {
    /// Absolute path of the data file.
    pub path: String,
    /// Directory holding it (and `backups/`).
    pub dir: String,
    /// True when running from the exe's own folder — copy the folder, keep everything.
    pub portable: bool,
    /// Whether the data file exists yet.
    pub exists: bool,
    pub backup_count: usize,
}

#[derive(Serialize, Clone)]
pub struct BackupEntry {
    pub name: String,
    pub bytes: u64,
    /// Seconds since the epoch, so the frontend can format it.
    pub modified: u64,
}

/// Can we actually create files here? Program Files is not writable for a
/// standard user, so "next to the exe" has to be tested, not assumed.
fn is_writable(dir: &Path) -> bool {
    let probe = dir.join(".blockbook-write-test");
    match fs::File::create(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Portable mode first, app-data second. docs/02-TRD.md §5.2
pub fn resolve(app: &AppHandle) -> StorageInfo {
    let (dir, portable) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .filter(|d| is_writable(d))
        .map(|d| (d, true))
        .unwrap_or_else(|| {
            let d = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let _ = fs::create_dir_all(&d);
            (d, false)
        });

    let path = dir.join(FILE);
    let backup_count = fs::read_dir(dir.join(BACKUP_DIR))
        .map(|rd| rd.filter_map(Result::ok).count())
        .unwrap_or(0);

    StorageInfo {
        exists: path.exists(),
        path: path.to_string_lossy().into_owned(),
        dir: dir.to_string_lossy().into_owned(),
        portable,
        backup_count,
    }
}

fn stamp() -> String {
    // Local time without pulling in chrono: seconds since epoch is enough to
    // sort, and the listing shows a real date via the file's mtime.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn backups_dir(app: &AppHandle) -> PathBuf {
    PathBuf::from(resolve(app).dir).join(BACKUP_DIR)
}

/// Keep only the newest `KEEP_BACKUPS`. Oldest go first.
fn prune(dir: &Path) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut files: Vec<_> = rd
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with("data-"))
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.path(), m.modified().ok()?))
        })
        .collect();

    if files.len() <= KEEP_BACKUPS {
        return;
    }
    files.sort_by_key(|(_, t)| *t);
    for (path, _) in files.iter().take(files.len() - KEEP_BACKUPS) {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub fn storage_info(app: AppHandle) -> StorageInfo {
    resolve(&app)
}

/// Read the data file. `None` means "not there yet", which is a first run, not
/// an error — the caller seeds instead.
#[tauri::command]
pub fn storage_read(app: AppHandle) -> Result<Option<String>, String> {
    let info = resolve(&app);
    let path = PathBuf::from(&info.path);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Could not read {}: {e}", info.path))
}

/// The write protocol. docs/02-TRD.md §5.3 — every step matters:
///
///   1. back up the CURRENT file (never the new one)
///   2. write to a temp file
///   3. flush + fsync so the bytes are actually on disk
///   4. atomically rename over the real file
///   5. prune old backups
///
/// A crash before step 4 leaves the previous `data.json` fully intact.
#[tauri::command]
pub fn storage_write(app: AppHandle, contents: String) -> Result<(), String> {
    let info = resolve(&app);
    let dir = PathBuf::from(&info.dir);
    let path = PathBuf::from(&info.path);
    let tmp = dir.join(TMP);

    // 1 — back up whatever is currently on disk.
    if path.exists() {
        let bdir = dir.join(BACKUP_DIR);
        fs::create_dir_all(&bdir).map_err(|e| format!("Could not create backups folder: {e}"))?;
        let dest = bdir.join(format!("data-{}.json", stamp()));
        // A failed backup must not block the write, but it must be visible.
        if let Err(e) = fs::copy(&path, &dest) {
            eprintln!("BlockBook: backup failed ({e}) — continuing with the write");
        }
    }

    // 2 + 3 — temp file, flushed and synced.
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Could not open {TMP}: {e}"))?;
        f.write_all(contents.as_bytes())
            .map_err(|e| format!("Could not write {TMP}: {e}"))?;
        f.flush().map_err(|e| format!("Could not flush {TMP}: {e}"))?;
        f.sync_all().map_err(|e| format!("Could not sync {TMP}: {e}"))?;
    }

    // 4 — atomic replace. On Windows this is MoveFileEx with REPLACE_EXISTING.
    fs::rename(&tmp, &path).map_err(|e| format!("Could not replace {}: {e}", info.path))?;

    // 5 — housekeeping, never fatal.
    prune(&dir.join(BACKUP_DIR));
    Ok(())
}

/// Move an unreadable file aside instead of destroying it. The user's
/// coordinates are not reconstructible; a bad parse must never cost them.
#[tauri::command]
pub fn storage_quarantine(app: AppHandle) -> Result<String, String> {
    let info = resolve(&app);
    let path = PathBuf::from(&info.path);
    if !path.exists() {
        return Err("Nothing to quarantine".into());
    }
    let dest = PathBuf::from(&info.dir).join(format!("data.json.corrupt-{}", stamp()));
    fs::rename(&path, &dest).map_err(|e| format!("Could not quarantine the file: {e}"))?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn storage_backups(app: AppHandle) -> Vec<BackupEntry> {
    let Ok(rd) = fs::read_dir(backups_dir(&app)) else {
        return vec![];
    };
    let mut out: Vec<BackupEntry> = rd
        .filter_map(Result::ok)
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            let modified = m
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(BackupEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                bytes: m.len(),
                modified,
            })
        })
        .collect();
    out.sort_by(|a, b| b.modified.cmp(&a.modified)); // newest first
    out
}

/// Read a backup's contents. Restoring is the frontend's decision — it
/// validates the payload first, exactly like any other import.
#[tauri::command]
pub fn storage_read_backup(app: AppHandle, name: String) -> Result<String, String> {
    // Refuse anything that is not a plain file name in the backups folder.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Invalid backup name".into());
    }
    let path = backups_dir(&app).join(&name);
    fs::read_to_string(&path).map_err(|e| format!("Could not read {name}: {e}"))
}

/// Open the data folder in Explorer so "where is my data?" is one click.
#[tauri::command]
pub fn storage_open_folder(app: AppHandle) -> Result<(), String> {
    let dir = resolve(&app).dir;
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Could not open {dir}: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        Err("Unsupported platform".into())
    }
}
