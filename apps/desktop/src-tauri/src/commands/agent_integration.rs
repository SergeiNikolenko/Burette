use serde::Serialize;
use serde_json::Value;
use std::collections::VecDeque;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const PLUGIN_NAMES: [&str; 2] = ["burette", "burrete"];
const PLUGIN_RELATIVE_PATH: &str = "plugins/burette-agent";
const MANIFEST_RELATIVE_PATH: &str = ".codex-plugin/plugin.json";
const CLAUDE_MANIFEST_RELATIVE_PATH: &str = ".claude-plugin/plugin.json";
const COMPATIBILITY_RELATIVE_PATH: &str = "compatibility.json";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AgentIntegrationStatus {
    schema: &'static str,
    state: String,
    app_version: &'static str,
    bundled_plugin: PluginBundleStatus,
    agent_installs: Vec<AgentInstallStatus>,
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
pub(crate) struct AgentInstallStatus {
    id: &'static str,
    label: &'static str,
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
                name: PLUGIN_NAMES[0].to_string(),
                version: None,
                path: None,
                display_name: None,
                compatibility: None,
            }
        }
    };

    let agent_installs = agent_install_statuses(bundled_plugin.version.as_deref());
    let state = if bundled_plugin.state != "ready" {
        "broken"
    } else if agent_installs.iter().any(|agent| agent.state == "current") {
        "ready"
    } else if agent_installs
        .iter()
        .any(|agent| agent.state == "update_available")
    {
        "update_available"
    } else if agent_installs
        .iter()
        .any(|agent| agent.state == "not_installed")
    {
        "install_available"
    } else {
        "ready"
    };

    AgentIntegrationStatus {
        schema: "burette_agent_integration.v2",
        state: state.to_string(),
        app_version: env!("CARGO_PKG_VERSION"),
        bundled_plugin,
        agent_installs,
        checks,
    }
}

fn bundle_status(path: &Path, checks: &mut Vec<AgentIntegrationCheck>) -> PluginBundleStatus {
    let manifest_path = path.join(MANIFEST_RELATIVE_PATH);
    let manifest = read_json(&manifest_path);
    let manifest_ok = manifest.as_ref().is_some_and(|value| {
        value
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(is_plugin_name)
    });
    checks.push(path_check(
        "manifest",
        "Plugin manifest",
        &manifest_path,
        manifest_ok,
        "Expected .codex-plugin/plugin.json for Burette.",
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
        ("mcp", "MCP server", "mcp/lib/server-bundle.mjs"),
        ("mcp-config", "MCP config", ".mcp.json"),
        ("skills", "Skills", "skills/index/SKILL.md"),
        (
            "preflight",
            "Preflight",
            "scripts/burette_agent_preflight.mjs",
        ),
        ("cli", "Agent CLI", "scripts/burette-agent.mjs"),
        (
            "browser-preview",
            "Browser preview",
            "scripts/agent-preview.mjs",
        ),
        (
            "browser-shell",
            "Browser shell",
            "browser-shell-dist/index.html",
        ),
        ("preview-web", "Preview web", "preview-web/index.html"),
    ] {
        let candidate = normalize_path(&path.join(relative_path));
        checks.push(path_check(
            id,
            label,
            &candidate,
            candidate.exists(),
            "Required by the Burette plugin.",
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
            .pointer("/requires/buretteApp")
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
        name: PLUGIN_NAMES[0].to_string(),
        version,
        path: Some(path.to_string_lossy().to_string()),
        display_name,
        compatibility: compatibility_summary,
    }
}

fn agent_install_statuses(bundled_version: Option<&str>) -> Vec<AgentInstallStatus> {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        let message = "HOME is not available, so local agent plugin installs cannot be inspected.";
        return vec![
            unknown_install("codex", "Codex", message),
            unknown_install("claude-code", "Claude Code", message),
        ];
    };

    vec![
        agent_install_status(
            "codex",
            "Codex",
            &home.join(".codex/plugins"),
            None,
            bundled_version,
        ),
        agent_install_status(
            "claude-code",
            "Claude Code",
            &home.join(".claude/plugins"),
            claude_registry_install(&home).as_ref(),
            bundled_version,
        ),
    ]
}

fn agent_install_status(
    id: &'static str,
    label: &'static str,
    plugins_root: &Path,
    registry_install: Option<&InstalledPluginManifest>,
    bundled_version: Option<&str>,
) -> AgentInstallStatus {
    if !plugins_root.exists() && registry_install.is_none() {
        return AgentInstallStatus {
            id,
            label,
            state: "not_installed".to_string(),
            version: None,
            path: None,
            message: format!("No {label} plugin directory was found for this user."),
        };
    }

    let found = registry_install
        .map(|install| InstalledPluginManifest {
            path: install.path.clone(),
            manifest: install.manifest.clone(),
        })
        .or_else(|| find_plugin_manifest(plugins_root));
    let Some(installed) = found else {
        return AgentInstallStatus {
            id,
            label,
            state: "not_installed".to_string(),
            version: None,
            path: None,
            message: format!("Burette is not installed in the local {label} plugins."),
        };
    };

    let version = installed
        .manifest
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && *value != "unknown")
        .map(ToOwned::to_owned);
    let state = match (bundled_version, version.as_deref()) {
        (Some(bundled), Some(current)) if bundled == current => "current",
        (Some(_), Some(_)) => "update_available",
        _ => "unknown",
    };
    let message = match state {
        "current" => format!("{label} has the same plugin version as this Burette bundle."),
        "update_available" => format!("{label} has a different Burette plugin version."),
        _ => format!("{label} has a Burette plugin, but the version could not be compared."),
    };

    AgentInstallStatus {
        id,
        label,
        state: state.to_string(),
        version,
        path: Some(installed.path.to_string_lossy().to_string()),
        message,
    }
}

fn unknown_install(id: &'static str, label: &'static str, message: &str) -> AgentInstallStatus {
    AgentInstallStatus {
        id,
        label,
        state: "unknown".to_string(),
        version: None,
        path: None,
        message: message.to_string(),
    }
}

fn claude_registry_install(home: &Path) -> Option<InstalledPluginManifest> {
    let registry = read_json(&home.join(".claude/plugins/installed_plugins.json"))?;
    let plugins = registry.get("plugins")?.as_object()?;
    for (key, installs) in plugins {
        let name = key.split('@').next().unwrap_or_default();
        if !is_plugin_name(name) {
            continue;
        }
        let install = installs.as_array()?.first()?;
        let install_path = PathBuf::from(install.get("installPath")?.as_str()?);
        let manifest = read_json(&install_path.join(CLAUDE_MANIFEST_RELATIVE_PATH))
            .or_else(|| read_json(&install_path.join(MANIFEST_RELATIVE_PATH)))
            .or_else(|| {
                install
                    .get("version")
                    .cloned()
                    .map(|version| serde_json::json!({ "name": name, "version": version }))
            })?;
        return Some(InstalledPluginManifest {
            path: install_path,
            manifest,
        });
    }
    None
}

struct InstalledPluginManifest {
    path: PathBuf,
    manifest: Value,
}

fn find_plugin_manifest(root: &Path) -> Option<InstalledPluginManifest> {
    let mut queue = VecDeque::from([root.to_path_buf()]);
    let mut visited = 0usize;
    while let Some(directory) = queue.pop_front() {
        visited += 1;
        if visited > 2_000 {
            return None;
        }
        for manifest_relative in [MANIFEST_RELATIVE_PATH, CLAUDE_MANIFEST_RELATIVE_PATH] {
            let manifest_path = directory.join(manifest_relative);
            if let Some(manifest) = read_json(&manifest_path) {
                if manifest
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(is_plugin_name)
                {
                    return Some(InstalledPluginManifest {
                        path: directory,
                        manifest,
                    });
                }
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

fn is_plugin_name(name: &str) -> bool {
    PLUGIN_NAMES.contains(&name)
}

fn find_bundled_plugin_root() -> Option<PathBuf> {
    if let Some(path) = env::var_os("BURETTE_AGENT_PLUGIN_DIR").map(PathBuf::from) {
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
