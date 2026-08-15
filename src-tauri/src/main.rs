// Prevents a console window appearing alongside the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    blockbook_lib::run()
}
