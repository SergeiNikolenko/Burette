//! Runtime keyboard-shortcut overrides for native menu items.
//!
//! The frontend registry (`apps/desktop/src/lib/keyboard-shortcuts.ts`) owns the
//! customizable command ids and their defaults. It sends the resolved
//! accelerator for every customizable menu item, defaults included, so this
//! side never has to remember what the build-time accelerator was.

use std::collections::HashMap;

use tauri::menu::MenuItemKind;
use tauri::Runtime;

use super::state::find_app_menu_item;

const MAX_ACCELERATOR_ENTRIES: usize = 128;
const MAX_MENU_ID_CHARS: usize = 96;
const MAX_ACCELERATOR_CHARS: usize = 64;

/// Applies `accelerators` (menu item id -> accelerator, empty = unassigned) to
/// the application menu. Every entry is attempted; failures are reported together.
pub(super) fn set_menu_accelerators<R: Runtime>(
    app: &tauri::AppHandle<R>,
    accelerators: &HashMap<String, String>,
) -> Result<(), String> {
    validate_accelerators(accelerators)?;
    let mut entries: Vec<_> = accelerators.iter().collect();
    entries.sort_unstable();
    let failures: Vec<String> = entries
        .into_iter()
        .filter_map(|(id, accelerator)| {
            set_accelerator(app, id, accelerator)
                .err()
                .map(|error| format!("{id}: {error}"))
        })
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn validate_accelerators(accelerators: &HashMap<String, String>) -> Result<(), String> {
    if accelerators.len() > MAX_ACCELERATOR_ENTRIES {
        return Err(format!(
            "at most {MAX_ACCELERATOR_ENTRIES} menu accelerators can be set at once"
        ));
    }
    for (id, accelerator) in accelerators {
        if id.is_empty() || id.chars().count() > MAX_MENU_ID_CHARS {
            return Err(format!("invalid menu item id {id:?}"));
        }
        if accelerator.chars().count() > MAX_ACCELERATOR_CHARS {
            return Err(format!("accelerator for {id} is too long"));
        }
    }
    Ok(())
}

fn set_accelerator<R: Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    accelerator: &str,
) -> Result<(), String> {
    let accelerator = Some(accelerator.trim()).filter(|value| !value.is_empty());
    match find_app_menu_item(app, id)? {
        MenuItemKind::MenuItem(item) => item.set_accelerator(accelerator),
        MenuItemKind::Check(item) => item.set_accelerator(accelerator),
        MenuItemKind::Icon(item) => item.set_accelerator(accelerator),
        MenuItemKind::Submenu(_) | MenuItemKind::Predefined(_) => {
            return Err("menu item has no customizable accelerator".to_string())
        }
    }
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_oversized_payloads() {
        let too_many: HashMap<String, String> = (0..=MAX_ACCELERATOR_ENTRIES)
            .map(|index| (format!("item.{index}"), String::new()))
            .collect();
        assert!(validate_accelerators(&too_many).is_err());

        let long_accelerator = HashMap::from([("file.open".to_string(), "K".repeat(65))]);
        assert!(validate_accelerators(&long_accelerator).is_err());

        let empty_id = HashMap::from([(String::new(), "CmdOrCtrl+O".to_string())]);
        assert!(validate_accelerators(&empty_id).is_err());

        let valid = HashMap::from([
            ("file.open".to_string(), "CmdOrCtrl+Shift+K".to_string()),
            ("file.save".to_string(), String::new()),
        ]);
        assert!(validate_accelerators(&valid).is_ok());
    }
}
