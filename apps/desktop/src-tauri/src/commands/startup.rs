use crate::startup::{agent_session_from_argv, PendingOpenDocuments};

#[tauri::command]
pub(crate) fn startup_documents<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
    pending: tauri::State<'_, PendingOpenDocuments>,
) -> Vec<String> {
    pending.drain_for_window(window.label())
}

#[tauri::command]
pub(crate) fn startup_agent_session<R: tauri::Runtime>(
    window: tauri::WebviewWindow<R>,
) -> Option<String> {
    if window.label() != crate::windows::MAIN_WINDOW_LABEL {
        return None;
    }
    agent_session_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}

#[cfg(test)]
mod tests {
    #[test]
    fn secondary_windows_do_not_attach_the_process_agent_session() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        for label in ["workspace-preview-test", "workspace-secondary"] {
            let window =
                tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::default())
                    .build()
                    .unwrap();
            assert_eq!(super::startup_agent_session(window), None);
        }
    }
}
