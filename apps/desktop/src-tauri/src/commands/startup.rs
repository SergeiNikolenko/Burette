use crate::startup::{agent_session_from_argv, file_args_from_argv};

#[tauri::command]
pub(crate) fn startup_documents() -> Vec<String> {
    file_args_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}

#[tauri::command]
pub(crate) fn startup_agent_session() -> Option<String> {
    agent_session_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}
