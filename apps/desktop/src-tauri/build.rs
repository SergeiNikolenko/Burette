fn main() {
    // Live controls for native context menus are AppKit views, written in
    // Objective-C and linked into the app on macOS.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/commands/context_menu_controls.m");
        cc::Build::new()
            .file("src/commands/context_menu_controls.m")
            .flag("-fobjc-arc")
            .compile("burette_context_menu_controls");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    tauri_build::build()
}
