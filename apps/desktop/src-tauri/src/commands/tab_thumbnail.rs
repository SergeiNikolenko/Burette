//! Tab hover previews show what a tab looked like the last time it was on
//! screen. Viewer frames are cross-origin to the shell, so the shell cannot read
//! their canvases; WebKit snapshots the composited page area instead.

use serde::Deserialize;

/// Width of the stored image in points. The hover card shows it at 304pt.
const THUMBNAIL_WIDTH_POINTS: f64 = 320.0;
const JPEG_QUALITY: f64 = 0.8;
const MAX_RECT_SIDE: f64 = 16_384.0;

/// Area of the page to capture, in CSS pixels from the webview's top-left.
#[derive(Clone, Copy, Debug, Deserialize)]
pub(crate) struct ThumbnailRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl ThumbnailRect {
    fn is_valid(&self) -> bool {
        [self.x, self.y, self.width, self.height]
            .iter()
            .all(|value| value.is_finite())
            && self.width >= 1.0
            && self.height >= 1.0
            && self.width <= MAX_RECT_SIDE
            && self.height <= MAX_RECT_SIDE
    }
}

/// Captures part of the window's webview as a JPEG data URL, or `None` when
/// WebKit could not produce an image.
#[tauri::command]
pub(crate) async fn capture_tab_thumbnail(
    window: tauri::WebviewWindow,
    rect: ThumbnailRect,
) -> Result<Option<String>, String> {
    if !rect.is_valid() {
        return Err("The thumbnail area is empty or out of range.".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, mut receiver) = tauri::async_runtime::channel(1);
        window
            .with_webview(move |webview| unsafe {
                macos::snapshot(webview.inner() as cocoa::base::id, rect, sender);
            })
            .map_err(|error| error.to_string())?;
        Ok(receiver.recv().await.flatten())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(None)
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{ThumbnailRect, JPEG_QUALITY, THUMBNAIL_WIDTH_POINTS};
    use base64::Engine;
    use block::ConcreteBlock;
    use cocoa::base::{id, nil};
    use cocoa::foundation::{NSPoint, NSRect, NSSize, NSString};
    use objc::{class, msg_send, sel, sel_impl};

    const NS_BITMAP_IMAGE_FILE_TYPE_JPEG: usize = 3;

    type Sender = tauri::async_runtime::Sender<Option<String>>;

    /// Runs on the main thread. WKWebView is flipped, so CSS coordinates map to
    /// view points after scaling by the window zoom.
    pub(super) unsafe fn snapshot(webview: id, rect: ThumbnailRect, sender: Sender) {
        let zoom: f64 = msg_send![webview, pageZoom];
        let zoom = if zoom.is_finite() && zoom > 0.0 {
            zoom
        } else {
            1.0
        };
        let configuration: id = msg_send![class!(WKSnapshotConfiguration), new];
        let area = NSRect::new(
            NSPoint::new(rect.x * zoom, rect.y * zoom),
            NSSize::new(rect.width * zoom, rect.height * zoom),
        );
        let _: () = msg_send![configuration, setRect: area];
        let width: id = msg_send![class!(NSNumber), numberWithDouble: THUMBNAIL_WIDTH_POINTS];
        let _: () = msg_send![configuration, setSnapshotWidth: width];

        let handler = ConcreteBlock::new(move |image: id, _error: id| {
            let encoded = if image == nil {
                None
            } else {
                jpeg_data_url(image)
            };
            let _ = sender.try_send(encoded);
        })
        .copy();
        let _: () = msg_send![
            webview,
            takeSnapshotWithConfiguration: configuration
            completionHandler: &*handler
        ];
        let _: () = msg_send![configuration, release];
    }

    unsafe fn jpeg_data_url(image: id) -> Option<String> {
        let tiff: id = msg_send![image, TIFFRepresentation];
        if tiff == nil {
            return None;
        }
        let bitmap: id = msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff];
        if bitmap == nil {
            return None;
        }
        let quality: id = msg_send![class!(NSNumber), numberWithDouble: JPEG_QUALITY];
        // The value of AppKit's NSImageCompressionFactor constant.
        let key = NSString::alloc(nil).init_str("NSImageCompressionFactor");
        let properties: id =
            msg_send![class!(NSDictionary), dictionaryWithObject: quality forKey: key];
        let _: () = msg_send![key, release];
        let data: id = msg_send![
            bitmap,
            representationUsingType: NS_BITMAP_IMAGE_FILE_TYPE_JPEG
            properties: properties
        ];
        if data == nil {
            return None;
        }
        let length: usize = msg_send![data, length];
        let bytes: *const u8 = msg_send![data, bytes];
        if bytes.is_null() || length == 0 {
            return None;
        }
        let jpeg = std::slice::from_raw_parts(bytes, length);
        Some(format!(
            "data:image/jpeg;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(jpeg)
        ))
    }
}
