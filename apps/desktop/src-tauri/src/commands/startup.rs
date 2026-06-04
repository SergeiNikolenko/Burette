use crate::startup::PendingOpenDocuments;

#[tauri::command]
pub(crate) fn startup_documents(pending: tauri::State<'_, PendingOpenDocuments>) -> Vec<String> {
    pending.drain()
}
