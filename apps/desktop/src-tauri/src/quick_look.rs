#[cfg(target_os = "macos")]
use std::process::Command;

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn reset_quick_look() -> Result<(), String> {
    Command::new("/usr/bin/qlmanage")
        .arg("-r")
        .spawn()
        .map_err(|err| err.to_string())?;
    Command::new("/usr/bin/qlmanage")
        .args(["-r", "cache"])
        .spawn()
        .map_err(|err| err.to_string())?;
    Command::new("/usr/bin/killall")
        .arg("quicklookd")
        .spawn()
        .map_err(|err| err.to_string())?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn reset_quick_look() -> Result<(), String> {
    Err("Quick Look reset is only available on macOS".into())
}
