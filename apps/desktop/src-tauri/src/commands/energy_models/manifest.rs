//! The energy models an installed Avogadro package declares in its
//! `pyproject.toml`, read as Avogadro's `PackageManager` and
//! `ScriptEnergy::readMetaData` read them (avogadrolibs
//! cb0e94852889da9f7288bd1e58241e69990935a7, BSD-3-Clause;
//! see docs/third-party/avogadro-LICENSE).
//!
//! Each `[[tool.avogadro.energy-models]]` entry names an identifier, a model
//! name, an input format, a protocol (`text-v1`, or `binary…` for binary-v1)
//! and `support.*` flags. Only the TOML subset these manifests use is read:
//! tables, arrays of tables, dotted keys, one-level inline tables, strings,
//! booleans and integers. Anything else is skipped, never guessed.

use std::collections::HashMap;

use serde::Serialize;

use crate::commands::avogadro_plugins::{valid_identifier, valid_script};

const MAX_MODELS: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Protocol {
    TextV1,
    BinaryV1,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DeclaredModel {
    pub(crate) identifier: String,
    pub(crate) name: String,
    pub(crate) description: String,
    /// `cjson`, `cml`, `mdl` or `mol` (MDL molfile), `pdb`, `sdf` or `xyz`. The
    /// start-up JSON carries the molecule under this key, as declared.
    pub(crate) input_format: String,
    pub(crate) protocol: Protocol,
    pub(crate) gradients: bool,
    pub(crate) ions: bool,
    pub(crate) radicals: bool,
    pub(crate) unit_cell: bool,
    /// Atomic numbers from `support.elements`; none means no element is supported.
    pub(crate) elements: Vec<u8>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Manifest {
    /// The package's `avogadro-*` console script.
    pub(crate) script: Option<String>,
    pub(crate) models: Vec<DeclaredModel>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Value {
    Text(String),
    Flag(bool),
    Integer(i64),
}

/// A basic or literal one-line string at the start of `text`, and the rest.
fn string(text: &str) -> Option<(String, &str)> {
    let quote = text.chars().next().filter(|c| *c == '"' || *c == '\'')?;
    if text.starts_with(&quote.to_string().repeat(3)) {
        return None;
    }
    let mut out = String::new();
    let mut chars = text[1..].char_indices();
    while let Some((index, character)) = chars.next() {
        if character == quote {
            return Some((out, &text[index + 2..]));
        }
        if quote == '"' && character == '\\' {
            let (_, escaped) = chars.next()?;
            out.push(match escaped {
                '"' => '"',
                '\\' => '\\',
                'n' => '\n',
                't' => '\t',
                _ => return None,
            });
        } else {
            out.push(character);
        }
    }
    None
}

/// One value at the start of `text` and the rest; inline tables flatten into
/// `prefix.key` entries of `out`.
fn value<'a>(text: &'a str, key: &str, out: &mut Vec<(String, Value)>) -> Option<&'a str> {
    let text = text.trim_start();
    if let Some((parsed, rest)) = string(text) {
        out.push((key.to_string(), Value::Text(parsed)));
        return Some(rest);
    }
    if let Some(mut rest) = text.strip_prefix('{') {
        loop {
            rest = rest.trim_start();
            if let Some(after) = rest.strip_prefix('}') {
                return Some(after);
            }
            let (name, after) = rest.split_once('=')?;
            let name = key_path(name)?;
            if name.contains('.') {
                return None;
            }
            rest = value(after, &format!("{key}.{name}"), out)?.trim_start();
            rest = rest.strip_prefix(',').unwrap_or(rest);
        }
    }
    let end = text
        .find(|c: char| c.is_whitespace() || c == ',' || c == '}' || c == '#')
        .unwrap_or(text.len());
    let token = &text[..end];
    let parsed = match token {
        "true" => Value::Flag(true),
        "false" => Value::Flag(false),
        _ => Value::Integer(token.replace('_', "").parse().ok()?),
    };
    out.push((key.to_string(), parsed));
    Some(&text[end..])
}

/// A dotted key with bare or double-quoted parts, joined by `.`.
fn key_path(text: &str) -> Option<String> {
    let parts: Option<Vec<_>> = text
        .split('.')
        .map(|part| {
            let part = part.trim();
            let part = part
                .strip_prefix('"')
                .and_then(|inner| inner.strip_suffix('"'))
                .unwrap_or(part);
            (!part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte)))
            .then_some(part)
        })
        .collect();
    Some(parts?.join("."))
}

fn display_text(value: Option<&Value>, max: usize) -> Option<String> {
    match value {
        Some(Value::Text(text))
            if !text.trim().is_empty()
                && text.chars().count() <= max
                && !text.chars().any(char::is_control) =>
        {
            Some(text.trim().to_string())
        }
        _ => None,
    }
}

/// Avogadro's `processElementString`: commas and whitespace separate atomic
/// numbers or `a-b` ranges within 1–119; reading stops at the first invalid token.
fn elements(spec: &str) -> Vec<u8> {
    let mut mask = [false; 120];
    let number = |text: &str| text.parse::<u8>().ok().filter(|n| (1..=119).contains(n));
    for token in spec.replace(',', " ").split_whitespace() {
        let range = match token.split_once('-') {
            Some((start, end)) => number(start).zip(number(end)),
            None => number(token).map(|n| (n, n)),
        };
        let Some((start, end)) = range else { break };
        (start..=end).for_each(|n| mask[usize::from(n)] = true);
    }
    (1..=119u8).filter(|n| mask[usize::from(*n)]).collect()
}

fn model(entry: &HashMap<String, Value>) -> Option<DeclaredModel> {
    let identifier = display_text(entry.get("identifier"), 64).filter(|id| valid_identifier(id))?;
    let name = display_text(entry.get("model-name"), 128)?;
    let input_format = display_text(entry.get("input-format"), 16).filter(|format| {
        ["cjson", "cml", "mdl", "mol", "pdb", "sdf", "xyz"].contains(&format.as_str())
    })?;
    let protocol = match display_text(entry.get("protocol"), 32) {
        Some(protocol) if protocol.starts_with("binary") => Protocol::BinaryV1,
        _ => Protocol::TextV1,
    };
    let flag = |key: &str| matches!(entry.get(key), Some(Value::Flag(true)));
    Some(DeclaredModel {
        identifier,
        name,
        description: display_text(entry.get("description"), 512).unwrap_or_default(),
        input_format,
        protocol,
        gradients: flag("support.gradients"),
        ions: flag("support.ions"),
        radicals: flag("support.radicals"),
        unit_cell: flag("support.unit-cell"),
        elements: match entry.get("support.elements") {
            Some(Value::Text(spec)) => elements(spec),
            _ => Vec::new(),
        },
    })
}

enum Section {
    Other,
    Scripts,
    Model(String),
}

pub(crate) fn read(pyproject: &str, package: &str) -> Manifest {
    let mut section = Section::Other;
    let mut scripts = Vec::new();
    let mut entries: Vec<HashMap<String, Value>> = Vec::new();
    for line in pyproject.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(header) = line.strip_prefix("[[") {
            let path = header.split_once("]]").and_then(|(path, _)| key_path(path));
            section = if path.as_deref() == Some("tool.avogadro.energy-models") {
                entries.push(HashMap::new());
                Section::Model(String::new())
            } else {
                Section::Other
            };
            continue;
        }
        if let Some(header) = line.strip_prefix('[') {
            let path = header.split_once(']').and_then(|(path, _)| key_path(path));
            section = match path.as_deref() {
                Some("project.scripts") => Section::Scripts,
                Some(path) if !entries.is_empty() => path
                    .strip_prefix("tool.avogadro.energy-models.")
                    .map_or(Section::Other, |sub| Section::Model(format!("{sub}."))),
                _ => Section::Other,
            };
            continue;
        }
        let Some((key, rest)) = line.split_once('=') else {
            continue;
        };
        let Some(key) = key_path(key) else { continue };
        match &section {
            Section::Scripts => scripts.push(key),
            Section::Model(prefix) => {
                let mut values = Vec::new();
                if value(rest, &format!("{prefix}{key}"), &mut values).is_some() {
                    let entry = entries.last_mut().expect("a model section has an entry");
                    for (key, value) in values {
                        entry.entry(key).or_insert(value);
                    }
                }
            }
            Section::Other => {}
        }
    }
    let scripts: Vec<_> = scripts
        .into_iter()
        .filter(|script| valid_script(script) && !script.ends_with("-setup"))
        .collect();
    let script = match scripts.as_slice() {
        [only] => Some(only.clone()),
        _ => scripts.iter().find(|script| *script == package).cloned(),
    };
    let mut models: Vec<DeclaredModel> = Vec::new();
    for declared in entries.iter().filter_map(model) {
        if models.len() < MAX_MODELS && models.iter().all(|m| m.identifier != declared.identifier) {
            models.push(declared);
        }
    }
    Manifest { script, models }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_avogadro_xtb_energy_manifest() {
        // avogadro-xtb-energy 0.2.0, ghutchis/avogadro-xtb-energy@287e8093.
        let manifest = read(
            r#"[project]
name = "avogadro-xtb-energy"
[project.scripts]
avogadro-xtb-energy = "avogadro_xtb_energy:main"
[tool.avogadro]
minimum-avogadro-version = "1.103"

[[tool.avogadro.energy-models]]
identifier = "GFN2"
model-name = "GFN2"
description = "Calculate GFN2-xTB energies and gradients"
input-format = "cjson"
protocol = "binary"
support.gradients = true
support.elements = "1-86"
support.unit-cell = false
support.ions = true
support.radicals = true

[[tool.avogadro.energy-models]]
identifier = "GFN-FF"
model-name = "GFN-FF"
protocol = "binary"
input-format = "cjson"
support = { gradients = true, elements = "1, 6-9, 35", radicals = false } # inline
[tool.pixi.workspace]
channels = ["conda-forge"]
"#,
            "avogadro-xtb-energy",
        );
        assert_eq!(manifest.script.as_deref(), Some("avogadro-xtb-energy"));
        assert_eq!(manifest.models.len(), 2);
        let gfn2 = &manifest.models[0];
        assert_eq!(
            (
                gfn2.identifier.as_str(),
                gfn2.input_format.as_str(),
                gfn2.protocol
            ),
            ("GFN2", "cjson", Protocol::BinaryV1)
        );
        assert!(gfn2.gradients && gfn2.ions && gfn2.radicals && !gfn2.unit_cell);
        assert_eq!(gfn2.elements, (1..=86).collect::<Vec<u8>>());
        assert_eq!(manifest.models[1].elements, vec![1, 6, 7, 8, 9, 35]);
        assert!(manifest.models[1].gradients && !manifest.models[1].radicals);
    }

    #[test]
    fn invalid_entries_are_dropped_and_text_is_the_default_protocol() {
        let manifest = read(
            r#"[project.scripts]
avogadro-a = "a:main"
avogadro-a-setup = "a:setup"
[[tool.avogadro.energy-models]]
identifier = "ok"
model-name = "OK"
input-format = "mdl"
[tool.avogadro.energy-models.support]
elements = "1-3, x, 9"
[[tool.avogadro.energy-models]]
identifier = "--debug x"
model-name = "Bad id"
input-format = "xyz"
[[tool.avogadro.energy-models]]
identifier = "noformat"
model-name = "No format"
[[tool.avogadro.energy-models]]
identifier = "ok"
model-name = "Duplicate"
input-format = "xyz"
"#,
            "a",
        );
        assert_eq!(manifest.script.as_deref(), Some("avogadro-a"));
        assert_eq!(manifest.models.len(), 1);
        let model = &manifest.models[0];
        assert_eq!(
            (
                model.input_format.as_str(),
                model.protocol,
                model.name.as_str()
            ),
            ("mdl", Protocol::TextV1, "OK")
        );
        // Reading stops at the first invalid token, as in Avogadro.
        assert_eq!(model.elements, vec![1, 2, 3]);
        assert!(!model.gradients);
        assert_eq!(read("[project]\nname = \"x\"\n", "x"), Manifest::default());
    }
}
