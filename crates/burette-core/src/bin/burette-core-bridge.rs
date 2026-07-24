use std::env;
use std::process;

use burette_core::{
    format_for_extension, is_supported_extension, normalize_renderer_mode,
    preview_plan_for_extension, quick_look_size_limit_for_extension, resolve_renderer,
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatResponse {
    molstar_format: String,
    is_binary: bool,
    external_only: bool,
    can_open_in_vesta: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RendererResponse {
    requested_mode: String,
    renderer: String,
    molstar_available: bool,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(usage)?;
    match command.as_str() {
        "supported-extension" => {
            let extension = args.next().ok_or_else(usage)?;
            ensure_no_extra_args(args)?;
            println!(
                "{}",
                if is_supported_extension(&extension)? {
                    "true"
                } else {
                    "false"
                }
            );
        }
        "size-limit" => {
            let extension = args.next().ok_or_else(usage)?;
            ensure_no_extra_args(args)?;
            println!("{}", quick_look_size_limit_for_extension(&extension));
        }
        "format" => {
            let extension = args.next().ok_or_else(usage)?;
            ensure_no_extra_args(args)?;
            let format = format_for_extension(&extension)?;
            write_json(&FormatResponse {
                molstar_format: format.molstar_format,
                is_binary: format.is_binary,
                external_only: format.external_only,
                can_open_in_vesta: format.can_open_in_vesta,
            })?;
        }
        "resolve-renderer" => {
            let extension = args.next().ok_or_else(usage)?;
            let requested = args.next().ok_or_else(usage)?;
            ensure_no_extra_args(args)?;
            let format = format_for_extension(&extension)?;
            let requested_mode = normalize_renderer_mode(&requested).to_string();
            write_json(&RendererResponse {
                renderer: resolve_renderer(&format, &requested),
                molstar_available: !format.external_only,
                requested_mode,
            })?;
        }
        "preview-plan" => {
            let extension = args.next().ok_or_else(usage)?;
            let requested = args.next().unwrap_or_else(|| "auto".to_string());
            ensure_no_extra_args(args)?;
            write_json(&preview_plan_for_extension(&extension, &requested)?)?;
        }
        _ => return Err(usage()),
    }
    Ok(())
}

fn write_json<T: Serialize>(value: &T) -> Result<(), String> {
    let encoded = serde_json::to_string(value).map_err(|err| err.to_string())?;
    println!("{encoded}");
    Ok(())
}

fn ensure_no_extra_args(mut args: impl Iterator<Item = String>) -> Result<(), String> {
    if args.next().is_some() {
        return Err(usage());
    }
    Ok(())
}

fn usage() -> String {
    "usage: burette-core-bridge <supported-extension|size-limit|format|resolve-renderer|preview-plan> <extension> [requested-renderer]".to_string()
}
