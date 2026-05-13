#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TitlebarDoubleClickAction {
    Maximize,
    Minimize,
    None,
}

impl TitlebarDoubleClickAction {
    fn as_str(self) -> &'static str {
        match self {
            Self::Maximize => "maximize",
            Self::Minimize => "minimize",
            Self::None => "none",
        }
    }
}

fn parse_titlebar_double_click_action(value: &str) -> TitlebarDoubleClickAction {
    match value.trim().to_ascii_lowercase().as_str() {
        "minimize" => TitlebarDoubleClickAction::Minimize,
        "none" => TitlebarDoubleClickAction::None,
        _ => TitlebarDoubleClickAction::Maximize,
    }
}

fn normalize_development_instance_name(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[tauri::command]
pub fn development_instance_name() -> Option<String> {
    ["BURRETE_DEV_INSTANCE_NAME", "BURRETE_INSTANCE_NAME"]
        .into_iter()
        .find_map(|key| std::env::var(key).ok().and_then(normalize_development_instance_name))
}

#[cfg(target_os = "macos")]
fn titlebar_double_click_action_value() -> TitlebarDoubleClickAction {
    let Ok(output) = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleActionOnDoubleClick"])
        .output()
    else {
        return TitlebarDoubleClickAction::Maximize;
    };
    if !output.status.success() {
        return TitlebarDoubleClickAction::Maximize;
    }
    parse_titlebar_double_click_action(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(not(target_os = "macos"))]
fn titlebar_double_click_action_value() -> TitlebarDoubleClickAction {
    TitlebarDoubleClickAction::Maximize
}

#[tauri::command]
pub fn titlebar_double_click_action() -> &'static str {
    titlebar_double_click_action_value().as_str()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_macos_titlebar_double_click_actions() {
        assert_eq!(
            parse_titlebar_double_click_action("Maximize\n"),
            TitlebarDoubleClickAction::Maximize
        );
        assert_eq!(
            parse_titlebar_double_click_action("Minimize"),
            TitlebarDoubleClickAction::Minimize
        );
        assert_eq!(
            parse_titlebar_double_click_action("None"),
            TitlebarDoubleClickAction::None
        );
        assert_eq!(
            parse_titlebar_double_click_action("unexpected"),
            TitlebarDoubleClickAction::Maximize
        );
    }

    #[test]
    fn normalizes_development_instance_name() {
        assert_eq!(
            normalize_development_instance_name("  Drag Test  ".to_string()),
            Some("Drag Test".to_string())
        );
        assert_eq!(normalize_development_instance_name("   ".to_string()), None);
    }
}
