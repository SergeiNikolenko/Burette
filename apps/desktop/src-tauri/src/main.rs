#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;
use std::process::ExitCode;

fn main() -> ExitCode {
    if is_cli_invocation() {
        let argv: Vec<_> = std::env::args_os().collect();
        let cwd = std::env::current_dir().unwrap_or_else(|_| Path::new(".").into());
        return burrete_lib::burrete_cli::run(
            argv,
            &cwd,
            &burrete_lib::burrete_cli::SystemLauncher,
        );
    }
    burrete_lib::run();
    ExitCode::SUCCESS
}

fn is_cli_invocation() -> bool {
    if std::env::var_os("BURRETE_CLI").is_some() {
        return true;
    }
    let Some(arg0) = std::env::args_os().next() else {
        return false;
    };
    Path::new(&arg0) == Path::new(burrete_lib::burrete_cli::INSTALL_TARGET)
}
