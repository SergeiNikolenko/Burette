use serde::Deserialize;
use tauri::State;

use crate::preview::grid_store::{GridPageResult, GridQuery, GridRuntimeRegistry};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GridPageRequest {
    document_id: String,
    query: Option<String>,
    sort: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
}

#[tauri::command]
pub(crate) fn grid_fetch_page(
    registry: State<'_, GridRuntimeRegistry>,
    request: GridPageRequest,
) -> Result<GridPageResult, String> {
    registry.fetch_page(
        &request.document_id,
        &GridQuery {
            query: request.query.unwrap_or_default(),
            sort: request.sort.unwrap_or_else(|| "index".to_string()),
            offset: request.offset.unwrap_or(0),
            limit: request.limit.unwrap_or(96),
        },
    )
}
