use crate::startup::file_args_from_argv;

#[tauri::command]
pub(crate) fn startup_documents() -> Vec<String> {
    file_args_from_argv(std::env::args().collect(), std::env::current_dir().ok())
}
