//! Lookups in the Avogadro plugin index (`plugins2.json`).

use serde::Deserialize;

pub(crate) const SAVED_INDEX: &str =
    include_str!("../../../../../../config/avogadro-plugin-index.snapshot.json");

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PluginLink {
    Source,
    Readme,
    Issues,
    Download,
}

/// The install-relevant fields of one validated index entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct IndexEntry {
    pub(crate) name: String,
    pub(crate) version: String,
    pub(crate) commit: String,
    pub(crate) sha256: String,
    pub(crate) archive_url: String,
}

pub(crate) fn valid_name(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._-".contains(&byte)
        })
}

pub(crate) fn valid_commit(commit: &str) -> bool {
    commit.len() == 40
        && commit
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn find<'a>(entries: &'a [serde_json::Value], name: &str) -> Option<&'a serde_json::Value> {
    entries
        .iter()
        .find(|entry| entry.get("name").and_then(|value| value.as_str()) == Some(name))
}

fn https(value: Option<&str>, hosts: &[&str]) -> Option<url::Url> {
    let url = url::Url::parse(value?.trim()).ok()?;
    let host = url.host_str()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && (hosts.is_empty() || hosts.contains(&host)))
    .then_some(url)
}

/// The entry the desktop runner may install: an installable Python package whose
/// archive is served by the Avogadro plugin host and pinned by SHA-256.
pub(crate) fn entry(index: &str, name: &str) -> Option<IndexEntry> {
    let entries: Vec<serde_json::Value> = serde_json::from_str(index).ok()?;
    let entry = find(&entries, name)?;
    let text = |pointer: &str| {
        entry
            .pointer(pointer)
            .and_then(|value| value.as_str())
            .map(str::to_string)
    };
    let (version, commit, sha256) = (
        text("/version")?,
        text("/git/commit")?,
        text("/src/sha256")?,
    );
    let archive = https(
        entry.pointer("/src/url").and_then(|value| value.as_str()),
        &["plugins.avogadro.cc"],
    )?;
    let installable = text("/plugin-type").as_deref() == Some("pypkg")
        && text("/metadata").as_deref() == Some("pyproject.toml");
    let sha_ok = sha256.len() == 64
        && sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    let version_ok = (1..=64).contains(&version.len())
        && version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+_-".contains(&byte));
    (valid_name(name) && installable && sha_ok && version_ok && valid_commit(&commit)).then(|| {
        IndexEntry {
            name: name.to_string(),
            version,
            commit,
            sha256,
            archive_url: archive.to_string(),
        }
    })
}

/// A plain https link for a plugin, on a host the catalog accepts for that kind.
pub(crate) fn plugin_link(index: &str, name: &str, link: PluginLink) -> Option<String> {
    let entries: Vec<serde_json::Value> = serde_json::from_str(index).ok()?;
    let entry = find(&entries, name)?;
    let value = |pointer: &str| entry.pointer(pointer).and_then(|value| value.as_str());
    let url = match link {
        PluginLink::Source => https(
            value("/git/repo"),
            &["github.com", "gitlab.com", "codeberg.org"],
        )?,
        PluginLink::Readme => https(value("/readme-url"), &[])?,
        PluginLink::Issues => https(value("/bug-tracker"), &[])?,
        PluginLink::Download => https(value("/src/url"), &["plugins.avogadro.cc"])?,
    };
    let text = url.to_string();
    Some(match link {
        PluginLink::Source => text
            .strip_suffix(".git")
            .map(str::to_string)
            .unwrap_or(text),
        _ => text,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_index_resolves_each_link_kind_and_the_install_entry_for_a_real_plugin() {
        assert_eq!(
            plugin_link(SAVED_INDEX, "avogadro-rdkit", PluginLink::Source).as_deref(),
            Some("https://github.com/ghutchis/avogadro-rdkit")
        );
        assert_eq!(
            entry(SAVED_INDEX, "avogadro-rdkit"),
            Some(IndexEntry {
                name: "avogadro-rdkit".into(),
                version: "0.3.0".into(),
                commit: "82498e3a3cedc2d465ccdcd93cabec1b2505dc5a".into(),
                sha256: "f93c4df5296eae7a52e482a3b334452adab1123d06330845db334879ceea9fa4".into(),
                archive_url: "https://plugins.avogadro.cc/dl/rdkit/82498e3a3cedc2d465ccdcd93cabec1b2505dc5a.zip".into(),
            })
        );
        assert!(
            plugin_link(SAVED_INDEX, "avogadro-rdkit", PluginLink::Issues).is_some_and(
                |url| url.starts_with("https://github.com/ghutchis/avogadro-rdkit/issues")
            )
        );
        assert!(plugin_link(SAVED_INDEX, "avogadro-rdkit", PluginLink::Readme).is_some());
        assert_eq!(
            plugin_link(SAVED_INDEX, "not-a-plugin", PluginLink::Source),
            None
        );
        assert_eq!(entry(SAVED_INDEX, "not-a-plugin"), None);
    }

    #[test]
    fn links_and_archives_outside_the_accepted_hosts_or_scheme_are_refused() {
        let index = r#"[
            {"name": "a", "version": "1", "plugin-type": "pypkg", "metadata": "pyproject.toml",
             "git": {"repo": "https://evil.example/a.git", "commit": "0000000000000000000000000000000000000000"},
             "src": {"url": "https://github.com/a.zip", "sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
             "readme-url": "http://example.com/readme", "bug-tracker": "https://user:pw@example.com/issues"},
            {"name": "b", "version": "1", "plugin-type": "pyscript", "metadata": "pyproject.toml",
             "git": {"repo": "javascript:alert(1)", "commit": "0000000000000000000000000000000000000000"},
             "src": {"url": "https://plugins.avogadro.cc/dl/b.zip", "sha256": "0000000000000000000000000000000000000000000000000000000000000000"},
             "bug-tracker": "https://example.com/issues"}
        ]"#;
        for link in [
            PluginLink::Source,
            PluginLink::Download,
            PluginLink::Readme,
            PluginLink::Issues,
        ] {
            assert_eq!(plugin_link(index, "a", link), None, "{link:?}");
        }
        assert_eq!(plugin_link(index, "b", PluginLink::Source), None);
        assert_eq!(
            plugin_link(index, "b", PluginLink::Issues).as_deref(),
            Some("https://example.com/issues")
        );
        assert_eq!(entry(index, "a"), None, "archive host");
        assert_eq!(entry(index, "b"), None, "not a Python package");
        assert_eq!(plugin_link("not json", "a", PluginLink::Source), None);
    }
}
