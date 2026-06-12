use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const PLUGIN_NAME: &str = "burrete";
const PLUGIN_RELATIVE_PATH: &str = "plugins/burette-agent";
const MANIFEST_RELATIVE_PATH: &str = ".codex-plugin/plugin.json";
const COMPATIBILITY_RELATIVE_PATH: &str = "compatibility.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentIntegrationStatus {
    schema: &'static str,
    state: String,
    app_version: &'static str,
    bundled_plugin: PluginBundleStatus,
    codex_install: CodexInstallStatus,
    checks: Vec<AgentIntegrationCheck>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginBundleStatus {
    state: String,
    name: String,
    version: Option<String>,
    path: Option<String>,
    display_name: Option<String>,
    compatibility: Option<CompatibilitySummary>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompatibilitySummary {
    app: Option<String>,
    agent_cli: Option<String>,
    control_api: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexInstallStatus {
    state: String,
    version: Option<String>,
    path: Option<String>,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentIntegrationCheck {
    id: &'static str,
    label: &'static str,
    state: String,
    detail: String,
}

#[tauri::command]
pub(crate) fn agent_integration_status() -> AgentIntegrationStatus {
    let plugin_root = find_bundled_plugin_root();
    let mut checks = Vec::new();

    let bundled_plugin = match plugin_root {
        Some(path) => bundle_status(&path, &mut checks),
        None => {
            checks.push(check(
                "bundle",
                "Bundled plugin",
                "missing",
                "plugins/burette-agent was not found near the app or current workspace.",
            ));
            PluginBundleStatus {
                state: "missing".to_string(),
                name: PLUGIN_NAME.to_string(),
                version: None,
                path: None,
                display_name: None,
                compatibility: None,
            }
        }
    };

    let codex_install = codex_install_status(bundled_plugin.version.as_deref());
    let state = if bundled_plugin.state != "ready" {
        "broken"
    } else if codex_install.state == "update_available" {
        "update_available"
    } else if codex_install.state == "not_installed" {
        "install_available"
    } else {
        "ready"
    };

    AgentIntegrationStatus {
        schema: "burette_agent_integration.v1",
        state: state.to_string(),
        app_version: env!("CARGO_PKG_VERSION"),
        bundled_plugin,
        codex_install,
        checks,
    }
}

fn bundle_status(path: &Path, checks: &mut Vec<AgentIntegrationCheck>) -> PluginBundleStatus {
    let manifest_path = path.join(MANIFEST_RELATIVE_PATH);
    let manifest = read_json(&manifest_path);
    let manifest_ok = manifest
        .as_ref()
        .is_some_and(|value| value.get("name").and_then(Value::as_str) == Some(PLUGIN_NAME));
    checks.push(path_check(
        "manifest",
        "Plugin manifest",
        &manifest_path,
        manifest_ok,
        "Expected .codex-plugin/plugin.json for Burrete.",
    ));

    let compatibility_path = path.join(COMPATIBILITY_RELATIVE_PATH);
    let compatibility = read_json(&compatibility_path);
    checks.push(path_check(
        "compatibility",
        "Compatibility manifest",
        &compatibility_path,
        compatibility.is_some(),
        "Expected compatibility.json with app and control API requirements.",
    ));

    for (id, label, relative_path) in [
        ("mcp", "MCP server", "mcp/server.mjs"),
        ("mcp-config", "MCP config", ".mcp.json"),
        ("skills", "Skills", "skills/index/SKILL.md"),
        (
            "widgets",
            "Widgets",
            "mcp/widget-assets/molecular-workspace/widget.html",
        ),
        (
            "preflight",
            "Preflight",
            "scripts/burette_agent_preflight.mjs",
        ),
        ("cli", "Agent CLI", "../../scripts/burrete-agent.mjs"),
        (
            "browser-preview",
            "Browser preview",
            "../../scripts/agent-preview.mjs",
        ),
    ] {
        let candidate = normalize_path(&path.join(relative_path));
        checks.push(path_check(
            id,
            label,
            &candidate,
            candidate.exists(),
            "Required by the Burrete plugin.",
        ));
    }

    let version = manifest
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let display_name = manifest
        .as_ref()
        .and_then(|value| value.pointer("/interface/displayName"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let compatibility_summary = compatibility.as_ref().map(|value| CompatibilitySummary {
        app: value
            .pointer("/requires/burreteApp")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        agent_cli: value
            .pointer("/requires/agentCli")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        control_api: value
            .pointer("/requires/controlApi")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    });
    let ready = checks.iter().all(|check| check.state == "ok");

    PluginBundleStatus {
        state: if ready { "ready" } else { "broken" }.to_string(),
        name: PLUGIN_NAME.to_string(),
        version,
        path: Some(path.to_string_lossy().to_string()),
        display_name,
        compatibility: compatibility_summary,
    }
}

fn codex_install_status(bundled_version: Option<&str>) -> CodexInstallStatus {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        return CodexInstallStatus {
            state: "unknown".to_string(),
            version: None,
            path: None,
            message: "HOME is not available, so the Codex plugin cache cannot be inspected."
                .to_string(),
        };
    };
    let cache = home.join(".codex/plugins/cache");
    if !cache.exists() {
        return CodexInstallStatus {
            state: "not_installed".to_string(),
            version: None,
            path: None,
            message: "No Codex plugin cache was found for this user.".to_string(),
        };
    }

    let Some(installed) = find_codex_plugin_manifest(&cache) else {
        return CodexInstallStatus {
            state: "not_installed".to_string(),
            version: None,
            path: None,
            message: "Burrete is not installed in the local Codex plugin cache.".to_string(),
        };
    };
    let version = installed
        .manifest
        .get("version")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let state = match (bundled_version, version.as_deref()) {
        (Some(bundled), Some(current)) if bundled == current => "current",
        (Some(_), Some(_)) => "update_available",
        _ => "unknown",
    };
    let message = match state {
        "current" => "The local Codex cache has the same plugin version as this Burrete bundle.",
        "update_available" => "The local Codex cache has a different Burrete plugin version.",
        _ => "Codex has a Burrete plugin manifest, but the version could not be compared.",
    };

    CodexInstallStatus {
        state: state.to_string(),
        version,
        path: Some(installed.path.to_string_lossy().to_string()),
        message: message.to_string(),
    }
}

struct InstalledPluginManifest {
    path: PathBuf,
    manifest: Value,
}

fn find_codex_plugin_manifest(cache: &Path) -> Option<InstalledPluginManifest> {
    let mut queue = VecDeque::from([cache.to_path_buf()]);
    let mut visited = 0usize;
    while let Some(directory) = queue.pop_front() {
        visited += 1;
        if visited > 2_000 {
            return None;
        }
        let manifest_path = directory.join(MANIFEST_RELATIVE_PATH);
        if let Some(manifest) = read_json(&manifest_path) {
            if manifest.get("name").and_then(Value::as_str) == Some(PLUGIN_NAME) {
                return Some(InstalledPluginManifest {
                    path: directory,
                    manifest,
                });
            }
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                queue.push_back(path);
            }
        }
    }
    None
}

fn find_bundled_plugin_root() -> Option<PathBuf> {
    if let Some(path) = env::var_os("BURRETE_AGENT_PLUGIN_DIR").map(PathBuf::from) {
        if path.join(MANIFEST_RELATIVE_PATH).exists() {
            return Some(normalize_path(&path));
        }
    }

    for base in candidate_base_paths() {
        for ancestor in base.ancestors() {
            let candidate = ancestor.join(PLUGIN_RELATIVE_PATH);
            if candidate.join(MANIFEST_RELATIVE_PATH).exists() {
                return Some(normalize_path(&candidate));
            }
        }
    }
    None
}

fn candidate_base_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(path) = env::current_dir() {
        paths.push(path);
    }
    if let Ok(path) = env::current_exe() {
        paths.push(path);
    }
    if let Ok(path) = env::var("RESOURCE_PATH") {
        paths.push(PathBuf::from(path));
    }
    paths
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn path_check(
    id: &'static str,
    label: &'static str,
    path: &Path,
    ok: bool,
    missing_detail: &'static str,
) -> AgentIntegrationCheck {
    if ok {
        check(id, label, "ok", &path.to_string_lossy())
    } else {
        check(id, label, "missing", missing_detail)
    }
}

fn check(
    id: &'static str,
    label: &'static str,
    state: &str,
    detail: &str,
) -> AgentIntegrationCheck {
    AgentIntegrationCheck {
        id,
        label,
        state: state.to_string(),
        detail: detail.to_string(),
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}
