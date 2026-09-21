use serde::Deserialize;
use url::Url;

const PUBCHEM_SEARCH_URL: &str = "https://pubchem.ncbi.nlm.nih.gov/search/search.cgi";
const MAX_SMILES_LENGTH: usize = 4096;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PubChemSearchType {
    Identity,
    Similarity,
}

#[tauri::command]
pub(crate) fn open_pubchem_search(
    search_type: PubChemSearchType,
    smiles: String,
) -> Result<(), String> {
    let url = pubchem_search_url(search_type, &smiles)?;
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|error| error.to_string())
}

fn pubchem_search_url(search_type: PubChemSearchType, smiles: &str) -> Result<Url, String> {
    let smiles = validate_smiles(smiles)?;
    let mut url = Url::parse(PUBCHEM_SEARCH_URL).map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("cmd", "search")
        .append_pair("q_type", "dt")
        .append_pair("q_data", smiles)
        .append_pair(
            "simp_schtp",
            match search_type {
                PubChemSearchType::Identity => "fs",
                PubChemSearchType::Similarity => "90",
            },
        );
    Ok(url)
}

fn validate_smiles(smiles: &str) -> Result<&str, String> {
    let smiles = smiles.trim();
    if smiles.is_empty() {
        return Err("PubChem search requires a non-empty SMILES string.".into());
    }
    if smiles.len() > MAX_SMILES_LENGTH {
        return Err(format!(
            "PubChem search is limited to {MAX_SMILES_LENGTH} SMILES characters."
        ));
    }
    if smiles.contains('*') {
        return Err(
            "PubChem identity and similarity searches do not accept wildcard atoms.".into(),
        );
    }
    if smiles.chars().any(char::is_control) {
        return Err("PubChem search does not accept control characters in SMILES.".into());
    }
    Ok(smiles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_search_encodes_structural_smiles() {
        let url =
            pubchem_search_url(PubChemSearchType::Identity, "C/C=C\\C").expect("identity URL");
        let parameters = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            parameters.get("q_data").map(|value| value.as_ref()),
            Some("C/C=C\\C")
        );
        assert_eq!(
            parameters.get("simp_schtp").map(|value| value.as_ref()),
            Some("fs")
        );
    }

    #[test]
    fn similarity_search_preserves_charges_and_salts() {
        let url = pubchem_search_url(PubChemSearchType::Similarity, "CC(=O)[O-].[Na+]")
            .expect("similarity URL");
        let parameters = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            parameters.get("q_data").map(|value| value.as_ref()),
            Some("CC(=O)[O-].[Na+]")
        );
        assert_eq!(
            parameters.get("simp_schtp").map(|value| value.as_ref()),
            Some("90")
        );
    }

    #[test]
    fn rejects_wildcard_empty_and_oversized_queries() {
        assert!(pubchem_search_url(PubChemSearchType::Identity, "").is_err());
        assert!(pubchem_search_url(PubChemSearchType::Identity, "C*").is_err());
        assert!(pubchem_search_url(PubChemSearchType::Identity, &"C".repeat(4097)).is_err());
    }
}
