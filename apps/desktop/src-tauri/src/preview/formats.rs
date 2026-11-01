pub(crate) use burette_core::{
    format_for_extension, normalize_renderer_mode, preview_plan_for_extension, resolve_renderer,
    structure_path_extension, supported_structure_extensions, FormatInfo,
};

// xTB writes XYZ frames to .trj/.log, while these suffixes can also describe
// unrelated formats. Match the browser's content-based route, not an alias.
pub(crate) fn format_for_data(extension: &str, data: &[u8]) -> Result<FormatInfo, String> {
    let runtime_extension = if matches!(extension, "log" | "out" | "trj" | "arc")
        && super::xyz::xyz_frame(data, 0).is_some_and(|frame| {
            String::from_utf8_lossy(&frame.data)
                .lines()
                .skip(2)
                .all(super::text_xyz::is_xyz_coordinate_line)
        }) {
        "xyz"
    } else {
        extension
    };
    format_for_extension(runtime_extension)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_xyz_frames_without_aliasing_other_trj_formats() {
        let xyz = b"2\n energy: -5.0\nH 0 0 0\nH 0 0 0.7\n2\n energy: -5.1\nH 0 0 0\nH 0 0 0.8\n";
        for extension in ["trj", "log", "out", "arc"] {
            let format = format_for_data(extension, xyz).unwrap();
            assert_eq!(format.molstar_format, "xyz");
            assert!(!format.is_binary);
        }
        for data in [
            b"AMBER trajectory\n 1.0 2.0 3.0\n".as_slice(),
            b"2\ncomment\nnot an atom\nstill not an atom\n",
            b"1\ncomment\nXx 0 0 0\n",
            b"1\ncomment\nC NaN 0 0\n",
        ] {
            assert_eq!(format_for_data("trj", data).unwrap().molstar_format, "trj");
        }
    }
}
