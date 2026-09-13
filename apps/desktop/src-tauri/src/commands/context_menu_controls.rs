//! Rich AppKit menu controls. Their callbacks belong to one popup and one IPC
//! channel, so changes cannot leak to another document or window.
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum MenuControl {
    Slider {
        value: f64,
        min: f64,
        max: f64,
        step: f64,
    },
    Palette {
        colors: Vec<String>,
        selected: Option<String>,
    },
    Text {
        value: String,
    },
    Color {
        value: String,
    },
}

#[derive(Serialize, Clone)]
pub(crate) struct ControlEvent {
    pub id: String,
    pub value: serde_json::Value,
    pub phase: &'static str,
}

impl MenuControl {
    pub(super) fn validate(&self) -> Result<(), String> {
        let valid = match self {
            Self::Slider {
                value,
                min,
                max,
                step,
            } => {
                [value, min, max, step].into_iter().all(|x| x.is_finite())
                    && min < max
                    && value >= min
                    && value <= max
                    && *step > 0.0
            }
            Self::Palette { colors, selected } => {
                !colors.is_empty()
                    && colors.len() <= 24
                    && colors.iter().all(|x| valid_color(x))
                    && selected.as_ref().is_none_or(|x| valid_color(x))
            }
            Self::Color { value } => valid_color(value),
            Self::Text { value } => value.len() <= 4096 && !value.contains('\0'),
        };
        if valid {
            Ok(())
        } else {
            Err("Invalid native menu control".into())
        }
    }
}
fn valid_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(target_os = "macos")]
pub(super) mod macos {
    use super::*;
    use crate::commands::context_menu::macos::string;
    use cocoa::base::{id, nil, NO, YES};
    use cocoa::foundation::{NSPoint, NSRect, NSSize};
    use objc::declare::ClassDecl;
    use objc::runtime::{Class, Object, Sel};
    use objc::{class, msg_send, sel, sel_impl};
    use std::sync::OnceLock;

    struct Binding {
        id: String,
        control: MenuControl,
        value: serde_json::Value,
        readout: id,
        sender: id,
        dirty: bool,
    }
    struct State {
        channel: Option<tauri::ipc::Channel<ControlEvent>>,
        bindings: Vec<Binding>,
        text: Option<usize>,
        hover_ids: std::collections::HashMap<usize, String>,
        hovered: Option<usize>,
    }
    pub(in crate::commands::context_menu) struct Controls {
        target: id,
        state: Box<State>,
    }

    extern "C" fn change(this: &mut Object, _: Sel, sender: id) {
        unsafe {
            let state = &mut *(*this.get_ivar::<*mut State>("state"));
            let tag: isize = msg_send![sender, tag];
            if let Some(binding) = state.bindings.get(tag as usize) {
                if matches!(binding.control, MenuControl::Palette { .. }) {
                    let group = binding.id.clone();
                    for other in &mut state.bindings {
                        if other.id == group {
                            other.dirty = false;
                            let _: () = msg_send![other.sender, setState: 0isize];
                        }
                    }
                }
            }
            let Some(binding) = state.bindings.get_mut(tag as usize) else {
                return;
            };
            match &binding.control {
                MenuControl::Slider { min, max, step, .. } => {
                    let raw: f64 = msg_send![sender, doubleValue];
                    let value = (min + ((raw - min) / step).round() * step).clamp(*min, *max);
                    binding.value = value.into();
                    let _: () = msg_send![sender, setDoubleValue: value];
                    let label = format!("{value:.3}")
                        .trim_end_matches('0')
                        .trim_end_matches('.')
                        .to_string();
                    let _: () = msg_send![binding.readout, setStringValue: string(&label)];
                }
                MenuControl::Palette { .. } => {
                    // Each swatch has its own binding with the chosen value.
                    let _: () = msg_send![sender, setState: 1isize];
                }
                MenuControl::Color { .. } if binding.readout != nil => {
                    let color: id = msg_send![sender, color];
                    let space: id = msg_send![class!(NSColorSpace), sRGBColorSpace];
                    let color: id = msg_send![color, colorUsingColorSpace: space];
                    if color.is_null() {
                        return;
                    }
                    let r: f64 = msg_send![color, redComponent];
                    let g: f64 = msg_send![color, greenComponent];
                    let b: f64 = msg_send![color, blueComponent];
                    binding.value = format!(
                        "#{:02x}{:02x}{:02x}",
                        (r.clamp(0.0, 1.0) * 255.0).round() as u8,
                        (g.clamp(0.0, 1.0) * 255.0).round() as u8,
                        (b.clamp(0.0, 1.0) * 255.0).round() as u8
                    )
                    .into();
                }
                MenuControl::Text { .. } | MenuControl::Color { .. } => {
                    state.text = Some(tag as usize);
                    let menu: id = msg_send![sender, menu];
                    let _: () = msg_send![menu, cancelTracking];
                    return;
                }
            }
            binding.dirty = true;
            if let Some(channel) = &state.channel {
                let _ = channel.send(ControlEvent {
                    id: binding.id.clone(),
                    value: binding.value.clone(),
                    phase: "input",
                });
            }
        }
    }
    extern "C" fn highlight(this: &mut Object, _: Sel, _: id, item: id) {
        unsafe {
            let state = &mut *(*this.get_ivar::<*mut State>("state"));
            let next = if item.is_null() {
                None
            } else {
                Some(item as usize)
            };
            if state.hovered == next {
                return;
            }
            if let Some(channel) = &state.channel {
                for (key, phase) in [(state.hovered, "leave"), (next, "enter")] {
                    if let Some(id) = key.and_then(|key| state.hover_ids.get(&key)) {
                        let _ = channel.send(ControlEvent {
                            id: id.clone(),
                            value: serde_json::Value::Null,
                            phase,
                        });
                    }
                }
            }
            state.hovered = next;
        }
    }
    fn target_class() -> &'static Class {
        static CLASS: OnceLock<&'static Class> = OnceLock::new();
        CLASS.get_or_init(|| {
            let mut c = ClassDecl::new("BuretteMenuControlTarget", class!(NSObject))
                .expect("unique menu control class");
            c.add_ivar::<*mut State>("state");
            unsafe {
                c.add_method(
                    sel!(menu:willHighlightItem:),
                    highlight as extern "C" fn(&mut Object, Sel, id, id),
                );
                c.add_method(sel!(change:), change as extern "C" fn(&mut Object, Sel, id));
            }
            c.register()
        })
    }
    unsafe fn frame(x: f64, y: f64, w: f64, h: f64) -> NSRect {
        NSRect::new(NSPoint::new(x, y), NSSize::new(w, h))
    }
    unsafe fn label(text: &str, rect: NSRect) -> id {
        let field: id = msg_send![class!(NSTextField), labelWithString: string(text)];
        let _: () = msg_send![field, setFrame: rect];
        let font: id = msg_send![class!(NSFont), systemFontOfSize: 13.0f64];
        let _: () = msg_send![field, setFont: font];
        field
    }
    impl Controls {
        pub(in crate::commands::context_menu) unsafe fn new(
            channel: Option<tauri::ipc::Channel<ControlEvent>>,
        ) -> Self {
            let mut state = Box::new(State {
                channel,
                bindings: Vec::new(),
                text: None,
                hover_ids: Default::default(),
                hovered: None,
            });
            let target: id = msg_send![target_class(), new];
            (*target).set_ivar("state", &mut *state as *mut State);
            Self { target, state }
        }
        pub(in crate::commands::context_menu) unsafe fn watch(
            &mut self,
            menu: id,
            item: id,
            key: &str,
        ) {
            self.state.hover_ids.insert(item as usize, key.into());
            let _: () = msg_send![menu, setDelegate: self.target];
        }
        unsafe fn bind(
            &mut self,
            sender: id,
            id: &str,
            control: &MenuControl,
            value: serde_json::Value,
            readout: id,
        ) {
            let tag = self.state.bindings.len() as isize;
            self.state.bindings.push(Binding {
                id: id.into(),
                control: control.clone(),
                value,
                readout,
                sender,
                dirty: false,
            });
            let _: () = msg_send![sender, setTarget: self.target];
            let _: () = msg_send![sender, setAction: sel!(change:)];
            let _: () = msg_send![sender, setTag: tag];
        }
        pub(in crate::commands::context_menu) unsafe fn make_item(
            &mut self,
            id: &str,
            text: &str,
            control: &MenuControl,
        ) -> id {
            let item: id = msg_send![class!(NSMenuItem), alloc];
            let item: id = msg_send![item, initWithTitle: string(text) action: sel!(change:) keyEquivalent: string("")];
            let item: id = msg_send![item, autorelease];
            if let MenuControl::Text { value } | MenuControl::Color { value } = control {
                self.bind(item, id, control, value.clone().into(), nil);
                return item;
            }
            let height = match control {
                MenuControl::Palette { colors, .. } => {
                    32.0 + colors.len().div_ceil(12) as f64 * 24.0
                }
                _ => 48.0,
            };
            let view: id = msg_send![class!(NSView), alloc];
            let view: id = msg_send![view, initWithFrame: frame(0.0, 0.0, 310.0, height)];
            let caption = label(text, frame(14.0, height - 22.0, 220.0, 18.0));
            let _: () = msg_send![view, addSubview: caption];
            match control {
                MenuControl::Slider {
                    value, min, max, ..
                } => {
                    let readout =
                        label(&value.to_string(), frame(244.0, height - 22.0, 52.0, 18.0));
                    let _: () = msg_send![readout, setAlignment: 2isize];
                    let _: () = msg_send![view, addSubview: readout];
                    let slider: id = msg_send![class!(NSSlider), alloc];
                    let slider: id =
                        msg_send![slider, initWithFrame: frame(14.0, 4.0, 282.0, 20.0)];
                    let _: () = msg_send![slider, setMinValue: *min];
                    let _: () = msg_send![slider, setMaxValue: *max];
                    let _: () = msg_send![slider, setDoubleValue: *value];
                    let _: () = msg_send![slider, setContinuous: YES];
                    let _: () = msg_send![slider, setAccessibilityLabel: string(text)];
                    self.bind(slider, id, control, (*value).into(), readout);
                    let _: () = msg_send![view, addSubview: slider];
                    let _: () = msg_send![slider, release];
                }
                MenuControl::Palette { colors, selected } => {
                    for (index, color) in colors.iter().enumerate() {
                        let button: id = msg_send![class!(NSButton), alloc];
                        let button: id = msg_send![button, initWithFrame: frame(12.0 + (index % 12) as f64 * 24.0, height - 51.0 - (index / 12) as f64 * 24.0, 24.0, 24.0)];
                        let _: () = msg_send![button, setTitle: string("●")];
                        let _: () = msg_send![button, setBordered: NO];
                        let font: id = msg_send![class!(NSFont), systemFontOfSize: 23.0f64];
                        let _: () = msg_send![button, setFont: font];
                        let rgb = u32::from_str_radix(&color[1..], 16).unwrap_or(0);
                        let tint: id = msg_send![class!(NSColor), colorWithSRGBRed: ((rgb >> 16) & 255) as f64 / 255.0 green: ((rgb >> 8) & 255) as f64 / 255.0 blue: (rgb & 255) as f64 / 255.0 alpha: 1.0f64];
                        let _: () = msg_send![button, setContentTintColor: tint];
                        let _: () = msg_send![button, setButtonType: 2usize];
                        let _: () = msg_send![button, setState: isize::from(selected.as_ref() == Some(color))];
                        let _: () = msg_send![button, setAccessibilityLabel: string(&format!("{text} {color}"))];
                        self.bind(button, id, control, color.clone().into(), nil);
                        let _: () = msg_send![view, addSubview: button];
                        let _: () = msg_send![button, release];
                    }
                }
                MenuControl::Text { .. } | MenuControl::Color { .. } => unreachable!(),
            }
            let _: () = msg_send![item, setView: view];
            let _: () = msg_send![view, release];
            item
        }
        pub(in crate::commands::context_menu) unsafe fn finish(&mut self) {
            if let Some(index) = self.state.text {
                if let MenuControl::Color { value } = &self.state.bindings[index].control {
                    let rgb = u32::from_str_radix(&value[1..], 16).unwrap_or(0);
                    let alert: id = msg_send![class!(NSAlert), new];
                    let _: () = msg_send![alert, setMessageText: string("Colour")];
                    let _: id = msg_send![alert, addButtonWithTitle: string("Done")];
                    let well: id = msg_send![class!(NSColorWell), alloc];
                    let well: id = msg_send![well, initWithFrame: frame(0.0, 0.0, 280.0, 36.0)];
                    let tint: id = msg_send![class!(NSColor), colorWithSRGBRed: ((rgb >> 16) & 255) as f64 / 255.0 green: ((rgb >> 8) & 255) as f64 / 255.0 blue: (rgb & 255) as f64 / 255.0 alpha: 1.0f64];
                    let _: () = msg_send![well, setColor: tint];
                    let _: () = msg_send![well, setContinuous: YES];
                    let _: () = msg_send![well, setTarget: self.target];
                    let _: () = msg_send![well, setAction: sel!(change:)];
                    let _: () = msg_send![well, setTag: index as isize];
                    self.state.bindings[index].readout = well;
                    let _: () = msg_send![alert, setAccessoryView: well];
                    let _: isize = msg_send![alert, runModal];
                    let _: () = msg_send![well, deactivate];
                    let _: () = msg_send![well, release];
                    let _: () = msg_send![alert, release];
                } else {
                    let binding = &mut self.state.bindings[index];
                    let alert: id = msg_send![class!(NSAlert), new];
                    let _: () = msg_send![alert, setMessageText: string("Edit text")];
                    let _: id = msg_send![alert, addButtonWithTitle: string("Apply")];
                    let _: id = msg_send![alert, addButtonWithTitle: string("Cancel")];
                    let input: id = msg_send![class!(NSTextField), alloc];
                    let input: id = msg_send![input, initWithFrame: frame(0.0, 0.0, 300.0, 24.0)];
                    let _: () = msg_send![input, setStringValue: string(binding.value.as_str().unwrap_or(""))];
                    let _: () = msg_send![alert, setAccessoryView: input];
                    let window: id = msg_send![alert, window];
                    let _: () = msg_send![window, setInitialFirstResponder: input];
                    let response: isize = msg_send![alert, runModal];
                    if response == 1000 {
                        let value: id = msg_send![input, stringValue];
                        let bytes: *const std::ffi::c_char = msg_send![value, UTF8String];
                        if !bytes.is_null() {
                            let text = std::ffi::CStr::from_ptr(bytes).to_string_lossy();
                            if text.len() <= 4096 {
                                binding.value = text.into_owned().into();
                                binding.dirty = true;
                            }
                        }
                    }
                    let _: () = msg_send![input, release];
                    let _: () = msg_send![alert, release];
                }
            }
            if let Some(channel) = &self.state.channel {
                for binding in &self.state.bindings {
                    if binding.dirty {
                        let _ = channel.send(ControlEvent {
                            id: binding.id.clone(),
                            value: binding.value.clone(),
                            phase: "change",
                        });
                    }
                }
                let _ = channel.send(ControlEvent {
                    id: String::new(),
                    value: serde_json::Value::Null,
                    phase: "finished",
                });
            }
        }
    }
    impl Drop for Controls {
        fn drop(&mut self) {
            unsafe {
                let _: () = msg_send![self.target, release];
            }
        }
    }
}
