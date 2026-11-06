fn main() {
    println!("cargo:rerun-if-env-changed=BURETTE_TELEMETRY_URL");
    println!("cargo:rerun-if-env-changed=BURETTE_TELEMETRY_NOTICE_URL");
    // Live controls for native context menus are AppKit views, written in
    // Objective-C and linked into the app on macOS.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/commands/context_menu_controls.m");
        cc::Build::new()
            .file("src/commands/context_menu_controls.m")
            .flag("-fobjc-arc")
            .compile("burette_context_menu_controls");
        println!("cargo:rustc-link-lib=framework=AppKit");
        // Menu text fields read raw key events from the Carbon dispatcher.
        println!("cargo:rustc-link-lib=framework=Carbon");
    }
    // Dialogs need Common Controls v6, which the app manifest requests.
    // tauri-build embeds it in the app binary only, and test binaries without
    // it fail to load (STATUS_ENTRYPOINT_NOT_FOUND), so every executable gets it.
    let mut attributes = tauri_build::Attributes::new();
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        println!("cargo:rerun-if-changed=windows-app-manifest.xml");
        let manifest =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("windows-app-manifest.xml");
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
        attributes = attributes
            .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
    }
    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
