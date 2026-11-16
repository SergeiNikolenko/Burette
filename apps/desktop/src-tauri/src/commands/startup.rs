use crate::startup::PendingOpenDocuments;

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
    pending: tauri::State<'_, PendingOpenDocuments>,
) -> Option<String> {
    pending.take_session(window.label())
}

#[cfg(test)]
mod tests {
    #[test]
    fn secondary_windows_do_not_attach_the_process_agent_session() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        use tauri::Manager;
        let app = mock_builder()
            .manage(crate::startup::PendingOpenDocuments::default())
            .build(mock_context(noop_assets()))
            .unwrap();
        for label in ["workspace-preview-test", "workspace-secondary"] {
            let window =
                tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::default())
                    .build()
                    .unwrap();
            assert_eq!(super::startup_agent_session(window, app.state()), None);
        }
    }
}
