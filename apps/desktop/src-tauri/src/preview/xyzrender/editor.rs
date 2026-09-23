use super::*;
use base64::Engine;
use serde::{Deserialize, Serialize};

const MAX_BYTES: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorRequest {
    path: String,
    preset: Option<String>,
    controls: Option<XyzrenderControls>,
    input_data_base64: Option<String>,
    input_extension: Option<String>,
    orientation_ref: Option<String>,
    #[serde(default)]
    save_reference: bool,
    animation: Option<Animation>,
    export_format: Option<ExportFormat>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum ExportFormat {
    Svg,
    Png,
    Pdf,
    Tiff,
}
impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Svg => "svg",
            Self::Png => "png",
            Self::Pdf => "pdf",
            Self::Tiff => "tiff",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Motion {
    Rotation,
    Bounce,
    Trajectory,
    Vibration,
    Assembly,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Animation {
    mode: Motion,
    axis: String,
    size: u32,
    frames: u32,
    fps: u32,
    amplitude: f64,
    #[serde(default)]
    rotate: bool,
    #[serde(default)]
    rebuild_bonds: bool,
    #[serde(default)]
    noise: f64,
    #[serde(default)]
    anchor: String,
    #[serde(default)]
    forward: bool,
}
impl Animation {
    fn arguments(&self, output: &Path) -> Result<Vec<String>, String> {
        let axis = self.axis.strip_prefix('-').unwrap_or(&self.axis);
        if !(matches!(
            axis,
            "x" | "y" | "z" | "xy" | "xz" | "yz" | "yx" | "zx" | "zy"
        ) || (axis.len() == 3 && axis.bytes().all(|b| b.is_ascii_digit())))
            || !(128..=1024).contains(&self.size)
            || !(2..=240).contains(&self.frames)
            || !(1..=30).contains(&self.fps)
            || u64::from(self.size).pow(2) * u64::from(self.frames) > 100_000_000
            || !self.amplitude.is_finite()
            || !(1.0..=360.0).contains(&self.amplitude)
            || !self.noise.is_finite()
            || !(0.0..=5.0).contains(&self.noise)
            || self.anchor.len() > 2000
            || !self.anchor.chars().all(|c| {
                c.is_ascii_alphanumeric() || c.is_ascii_whitespace() || matches!(c, '_' | ',' | '-')
            })
        {
            return Err("Invalid or oversized xyzrender animation options".into());
        }
        let mut args = vec![
            "-S".into(),
            self.size.to_string(),
            "--gif-fps".into(),
            self.fps.to_string(),
            "--rot-frames".into(),
            self.frames.to_string(),
            "-go".into(),
            output.display().to_string(),
        ];
        let rotation = format!("--gif-rot={}", self.axis);
        match self.mode {
            Motion::Rotation => args.push(rotation),
            Motion::Bounce => {
                if self.amplitude > 180.0 {
                    return Err("Rock angle must not exceed 180 degrees".into());
                }
                args.extend([
                    "--gif-bounce".into(),
                    format!("{},{}", self.amplitude, self.axis),
                ]);
            }
            Motion::Trajectory | Motion::Vibration => {
                match self.mode {
                    Motion::Trajectory => {
                        args.push("--gif-trj".into());
                        if self.rebuild_bonds {
                            args.push("--trj-bonds".into());
                        }
                    }
                    Motion::Vibration => args.extend([
                        "--gif-ts".into(),
                        "--vib-frames".into(),
                        self.frames.to_string(),
                    ]),
                    _ => unreachable!(),
                }
                if self.rotate {
                    args.push(rotation);
                }
            }
            Motion::Assembly => {
                args.extend([
                    "--gif-diffuse".into(),
                    "--diffuse-frames".into(),
                    self.frames.to_string(),
                    "--diffuse-noise".into(),
                    self.noise.to_string(),
                    "--diffuse-bonds".into(),
                    "fade".into(),
                ]);
                if self.forward {
                    args.push("--diffuse-forward".into());
                }
                if self.rotate {
                    args.extend([rotation, "--diffuse-rot".into(), self.amplitude.to_string()]);
                }
                if !self.anchor.is_empty() {
                    args.extend(["--anchor".into(), self.anchor.clone()]);
                }
            }
        }
        Ok(args)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditorResult {
    svg: String,
    orientation_ref: Option<String>,
    gif_base64: Option<String>,
    artifact_base64: Option<String>,
}

fn read_bounded(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("xyzrender input or output exceeds the 16 MB limit or is empty".into());
    }
    Ok(bytes)
}

pub(crate) fn render(request: EditorRequest, directory: &Path) -> Result<EditorResult, String> {
    let extension = request
        .input_extension
        .as_deref()
        .or_else(|| Path::new(&request.path).extension()?.to_str())
        .unwrap_or("xyz")
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if extension.is_empty()
        || extension.len() > 12
        || !extension.bytes().all(|b| b.is_ascii_alphanumeric())
    {
        return Err("Invalid structure extension".into());
    }
    let bytes = if let Some(data) = request
        .input_data_base64
        .as_deref()
        .filter(|s| !s.is_empty())
    {
        if data.len() > MAX_BYTES * 4 / 3 + 4 {
            return Err("Inline structure exceeds 16 MB".into());
        }
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .map_err(|e| e.to_string())?
    } else {
        let path = Path::new(&request.path);
        if !path.is_absolute() {
            return Err("Structure path must be absolute".into());
        }
        read_bounded(path)?
    };
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Invalid structure size".into());
    }
    // Always stage the input: vibration extraction can write beside its source.
    let input = directory.join(format!("input.{extension}"));
    fs::write(&input, &bytes).map_err(|e| e.to_string())?;
    let output = directory.join("figure.svg");
    let reference = directory.join("orientation.xyz");
    let ref_path = if request.save_reference || request.orientation_ref.is_some() {
        Some(reference.as_path())
    } else {
        None
    };
    if let Some(text) = &request.orientation_ref {
        let normalized =
            normalize_orientation_ref(Some(text)).ok_or("Invalid orientation reference")?;
        fs::write(&reference, normalized).map_err(|e| e.to_string())?;
    }
    let executable = resolve_xyzrender_executable()?;
    let preset = normalize_preset(request.preset.as_deref());
    let execute = |output: &Path,
                   animation: Option<&Animation>,
                   reference: Option<&Path>|
     -> Result<bool, String> {
        let animation_args = animation
            .map(|value| value.arguments(&directory.join("animation.gif")))
            .transpose()?
            .unwrap_or_default();
        let run = |reference: Option<&Path>| -> Result<(std::process::ExitStatus, String), String> {
            let mut args = build_xyzrender_args(
                &input,
                output,
                preset,
                reference,
                request.controls.as_ref(),
                None,
            );
            args.extend(animation_args.iter().cloned());
            let mut command = Command::new(&executable);
            command
                .args(args)
                .env("PYTHON_CPU_COUNT", "4")
                .env("OPENBLAS_NUM_THREADS", "1")
                .env("OMP_NUM_THREADS", "1");
            if cfg!(target_os = "macos") && output.extension().is_some_and(|ext| ext == "pdf") {
                let mut paths = std::env::var_os("DYLD_FALLBACK_LIBRARY_PATH")
                    .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
                    .unwrap_or_default();
                paths.extend(["/opt/homebrew/lib".into(), "/usr/local/lib".into()]);
                command.env(
                    "DYLD_FALLBACK_LIBRARY_PATH",
                    std::env::join_paths(paths).map_err(|error| error.to_string())?,
                );
            }
            let timeout = if animation.is_some() {
                Duration::from_secs(120)
            } else {
                XYZRENDER_TIMEOUT
            };
            run_xyzrender_process(command, &directory.join("render.log"), timeout)
        };
        let (mut status, mut log) = run(reference)?;
        let periodic_reference = reference.is_some()
            && !status.success()
            && xyzrender_ref_unsupported_for_periodic(&log);
        if periodic_reference {
            let _ = fs::remove_file(output);
            (status, log) = run(None)?;
        }
        if !status.success() {
            let detail = log
                .lines()
                .rev()
                .find(|line| line.starts_with("xyzrender: error:"))
                .unwrap_or_else(|| log.lines().last().unwrap_or("Unknown renderer error"));
            return Err(format!("xyzrender failed: {}", truncate_text(detail, 1024)));
        }
        Ok(periodic_reference)
    };
    let periodic_reference = execute(&output, request.animation.as_ref(), ref_path)?;
    let svg = String::from_utf8(read_bounded(&output)?).map_err(|e| e.to_string())?;
    let gif_base64 = request
        .animation
        .as_ref()
        .map(|_| {
            read_bounded(&directory.join("animation.gif"))
                .map(|b| base64::engine::general_purpose::STANDARD.encode(b))
        })
        .transpose()?;
    let artifact_base64 = request
        .export_format
        .map(|format| {
            if matches!(format, ExportFormat::Svg) {
                return Ok(base64::engine::general_purpose::STANDARD.encode(svg.as_bytes()));
            }
            let path = directory.join(format!("export.{}", format.extension()));
            execute(&path, None, ref_path)?;
            read_bounded(&path).map(|b| base64::engine::general_purpose::STANDARD.encode(b))
        })
        .transpose()?;
    let orientation_ref = if ref_path.is_some() && !periodic_reference {
        Some(String::from_utf8(read_bounded(&reference)?).map_err(|e| e.to_string())?)
    } else {
        None
    };
    Ok(EditorResult {
        svg,
        orientation_ref,
        gif_base64,
        artifact_base64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> EditorRequest {
        serde_json::from_value(serde_json::json!({
            "path": "molecule.xyz", "inputExtension": "xyz",
            "inputDataBase64": base64::engine::general_purpose::STANDARD.encode("2\nH2\nH 0 0 0\nH 0 0 0.74\n"),
            "animation": { "mode": "rotation", "axis": "-y", "size": 128, "frames": 4, "fps": 10, "amplitude": 45 }
        })).unwrap()
    }
    #[test]
    fn rejects_oversized_animation_and_axis_injection() {
        let mut request = request();
        let animation = request.animation.as_mut().unwrap();
        animation.size = 1024;
        animation.frames = 240;
        assert!(animation.arguments(Path::new("animation.gif")).is_err());
        animation.size = 128;
        animation.axis = "y --output /tmp/other".into();
        assert!(animation.arguments(Path::new("animation.gif")).is_err());
    }
    #[test]
    fn rejects_inline_path_traversal_before_writing() {
        let mut request = request();
        request.input_extension = Some("../xyz".into());
        assert_eq!(
            render(request, Path::new("/does-not-exist"))
                .err()
                .as_deref(),
            Some("Invalid structure extension")
        );
    }
    #[test]
    #[ignore = "requires the local xyzrender runtime"]
    fn native_editor_renders_gif_and_orientation_reference() {
        let directory =
            std::env::temp_dir().join(format!("burette-editor-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let result = render(request(), &directory).unwrap();
        let gif = base64::engine::general_purpose::STANDARD
            .decode(result.gif_base64.unwrap())
            .unwrap();
        assert!(gif.starts_with(b"GIF89a"));
        assert!(result.svg.contains("<svg"));
        let mut reference_request = request();
        reference_request.animation = None;
        reference_request.save_reference = true;
        let result = render(reference_request, &directory).unwrap();
        assert!(result
            .orientation_ref
            .as_ref()
            .unwrap()
            .trim()
            .starts_with('2'));
        for (format, magic) in [
            (ExportFormat::Png, &b"\x89PNG\r\n\x1a\n"[..]),
            (ExportFormat::Pdf, &b"%PDF-"[..]),
            (ExportFormat::Tiff, &b"II*\0"[..]),
        ] {
            let mut export_request = request();
            export_request.animation = None;
            export_request.orientation_ref = result.orientation_ref.clone();
            export_request.export_format = Some(format);
            let exported = render(export_request, &directory).unwrap();
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(exported.artifact_base64.unwrap())
                .unwrap();
            assert!(
                bytes.starts_with(magic),
                "{} export header",
                format.extension()
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    #[ignore = "requires the local xyzrender runtime"]
    fn native_editor_renders_periodic_xyz_without_reference() {
        let directory =
            std::env::temp_dir().join(format!("burette-periodic-editor-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let mut request = request();
        request.input_data_base64 = Some(base64::engine::general_purpose::STANDARD.encode(
            include_bytes!("../../../../../../samples/structures/demo/caffeine_cell.xyz"),
        ));
        request.save_reference = true;
        request.animation = None;
        let result = render(request, &directory).unwrap();
        assert!(result.svg.contains("<svg"));
        assert!(result.orientation_ref.is_none());
        fs::remove_dir_all(directory).unwrap();
    }
}
