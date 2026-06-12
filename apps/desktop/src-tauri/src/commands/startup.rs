use crate::startup::{agent_session_from_argv, PendingOpenDocuments};

#[tauri::command]
pub(crate) fn startup_documents(pending: tauri::State<'_, PendingOpenDocuments>) -> Vec<String> {
    pending.drain()
}

#[tauri::command]
pub(crate) fn startup_agent_session() -> Option<String> {
    agent_session_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}
