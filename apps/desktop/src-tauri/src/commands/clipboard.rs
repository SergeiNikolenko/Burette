/// Native menu actions can finish after WKWebView's clipboard user gesture
/// expires. Write directly to the pasteboard instead of relying on Web APIs.
#[tauri::command]
pub(crate) fn write_clipboard_text(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use cocoa::appkit::{NSPasteboard, NSPasteboardTypeString};
        use cocoa::base::{nil, YES};
        use cocoa::foundation::NSString;
        use objc::rc::{autoreleasepool, StrongPtr};

        autoreleasepool(|| unsafe {
            let string = StrongPtr::new(NSString::alloc(nil).init_str(&text));
            let pasteboard = NSPasteboard::generalPasteboard(nil);
            pasteboard.clearContents();
            if pasteboard.setString_forType(*string, NSPasteboardTypeString) == YES {
                Ok(())
            } else {
                Err("Could not write text to the clipboard".into())
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err("Native clipboard writing is only supported on macOS".into())
    }
}
