use flate2::read::DeflateDecoder;
use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;

const NPY_MAGIC: &[u8] = b"\x93NUMPY";
const ZIP_LOCAL_FILE_MAGIC: &[u8] = b"PK\x03\x04";
const ZIP_CENTRAL_DIRECTORY_MAGIC: &[u8] = b"PK\x01\x02";
const ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC: &[u8] = b"PK\x05\x06";
const NUMPY_PREVIEW_VALUE_LIMIT: usize = 4096;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NumpyArraySummary {
    pub(crate) name: String,
    pub(crate) dtype: String,
    pub(crate) shape: Vec<usize>,
    pub(crate) value_count: usize,
    pub(crate) min: Option<f64>,
    pub(crate) max: Option<f64>,
    pub(crate) mean: Option<f64>,
    pub(crate) nan_count: usize,
    pub(crate) values: Vec<Option<f64>>,
    pub(crate) unsupported: Option<String>,
}

#[derive(Debug)]
struct NpyHeader {
    dtype: String,
    shape: Vec<usize>,
    fortran_order: bool,
    data_offset: usize,
}

#[derive(Debug, Clone, Copy)]
struct DType {
    endian: Endian,
    kind: DTypeKind,
    size: usize,
}

#[derive(Debug, Clone, Copy)]
enum Endian {
    Little,
    Big,
    Native,
}

#[derive(Debug, Clone, Copy)]
enum DTypeKind {
    Float,
    Signed,
    Unsigned,
    Bool,
}

pub(crate) fn is_numpy_artifact_extension(extension: &str) -> bool {
    matches!(extension, "npy" | "npz")
}

pub(crate) fn numpy_artifact_text_summary(path: &Path, byte_count: u64) -> Result<String, String> {
    let arrays = read_numpy_arrays(path, NUMPY_PREVIEW_VALUE_LIMIT)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let title = if extension == "npz" {
        "NumPy NPZ archive"
    } else {
        "NumPy NPY array"
    };
    let mut lines = vec![
        title.to_string(),
        String::new(),
        format!("File: {}", path.display()),
        format!("Size: {byte_count} bytes"),
        String::new(),
        "| Array | Shape | Dtype | Values | Min | Max | Mean | NaN | Notes |".to_string(),
        "| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- |".to_string(),
    ];
    for array in arrays {
        lines.push(format!(
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            markdown_cell(&array.name),
            markdown_cell(&format_shape(&array.shape)),
            markdown_cell(&array.dtype),
            array.value_count,
            format_optional(array.min),
            format_optional(array.max),
            format_optional(array.mean),
            array.nan_count,
            markdown_cell(array.unsupported.as_deref().unwrap_or(""))
        ));
    }
    lines.push(String::new());
    Ok(lines.join("\n"))
}

pub(crate) fn read_numpy_arrays(
    path: &Path,
    max_values: usize,
) -> Result<Vec<NumpyArraySummary>, String> {
    let bytes = fs::read(path).map_err(|err| format!("{}: {err}", path.display()))?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if extension == "npy" {
        return Ok(vec![parse_npy_array(
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("array"),
            &bytes,
            max_values,
        )?]);
    }
    if extension == "npz" {
        return parse_npz_arrays(&bytes, max_values)
            .map_err(|err| format!("{}: {err}", path.display()));
    }
    Err(format!("{} is not a NumPy artifact", path.display()))
}

fn parse_npz_arrays(bytes: &[u8], max_values: usize) -> Result<Vec<NumpyArraySummary>, String> {
    let mut offset = 0usize;
    let mut arrays = Vec::new();
    while offset + 4 <= bytes.len() {
        let signature = &bytes[offset..offset + 4];
        if signature == ZIP_CENTRAL_DIRECTORY_MAGIC
            || signature == ZIP_END_OF_CENTRAL_DIRECTORY_MAGIC
        {
            break;
        }
        if signature != ZIP_LOCAL_FILE_MAGIC {
            return Err(format!("invalid NPZ local file header at byte {offset}"));
        }
        if offset + 30 > bytes.len() {
            return Err("truncated NPZ local file header".to_string());
        }
        let flags = read_u16_le(bytes, offset + 6)?;
        let compression = read_u16_le(bytes, offset + 8)?;
        let raw_compressed_size = read_u32_le(bytes, offset + 18)?;
        let raw_uncompressed_size = read_u32_le(bytes, offset + 22)?;
        let file_name_length = read_u16_le(bytes, offset + 26)? as usize;
        let extra_length = read_u16_le(bytes, offset + 28)? as usize;
        let name_start = offset + 30;
        let name_end = name_start + file_name_length;
        let data_start = name_end + extra_length;
        if name_end > bytes.len() || data_start > bytes.len() {
            return Err("truncated NPZ entry metadata".to_string());
        }
        let extra = &bytes[name_end..data_start];
        let compressed_size =
            zip_entry_compressed_size(extra, raw_uncompressed_size, raw_compressed_size)?;
        let data_end = data_start + compressed_size;
        if flags & 0x08 != 0 {
            return Err("NPZ entries with data descriptors are not supported".to_string());
        }
        if data_end > bytes.len() {
            return Err("truncated NPZ entry data".to_string());
        }
        let name = String::from_utf8_lossy(&bytes[name_start..name_end]).to_string();
        let compressed = &bytes[data_start..data_end];
        if name.ends_with(".npy") {
            let entry_bytes = match compression {
                0 => compressed.to_vec(),
                8 => {
                    let mut decoder = DeflateDecoder::new(compressed);
                    let mut decompressed = Vec::new();
                    decoder
                        .read_to_end(&mut decompressed)
                        .map_err(|err| format!("{name}: failed to inflate entry: {err}"))?;
                    decompressed
                }
                other => {
                    arrays.push(NumpyArraySummary {
                        name,
                        dtype: String::new(),
                        shape: Vec::new(),
                        value_count: 0,
                        min: None,
                        max: None,
                        mean: None,
                        nan_count: 0,
                        values: Vec::new(),
                        unsupported: Some(format!(
                            "ZIP compression method {other} is not supported"
                        )),
                    });
                    offset = data_end;
                    continue;
                }
            };
            arrays.push(parse_npy_array(
                &trim_npy_suffix(&name),
                &entry_bytes,
                max_values,
            )?);
        }
        offset = data_end;
    }
    if arrays.is_empty() {
        return Err("NPZ archive contains no .npy arrays".to_string());
    }
    Ok(arrays)
}

fn parse_npy_array(
    name: &str,
    bytes: &[u8],
    max_values: usize,
) -> Result<NumpyArraySummary, String> {
    let header = parse_npy_header(bytes)?;
    let value_count = checked_value_count(&header.shape)?;
    let Some(dtype) = parse_dtype(&header.dtype) else {
        return Ok(NumpyArraySummary {
            name: name.to_string(),
            dtype: header.dtype,
            shape: header.shape,
            value_count,
            min: None,
            max: None,
            mean: None,
            nan_count: 0,
            values: Vec::new(),
            unsupported: Some(
                "structured, object, complex, or string dtype is not previewed".to_string(),
            ),
        });
    };
    if header.fortran_order && header.shape.len() > 1 {
        return Ok(NumpyArraySummary {
            name: name.to_string(),
            dtype: header.dtype,
            shape: header.shape,
            value_count,
            min: None,
            max: None,
            mean: None,
            nan_count: 0,
            values: Vec::new(),
            unsupported: Some("Fortran-order arrays are summarized as metadata only".to_string()),
        });
    }
    let available_values = bytes
        .len()
        .saturating_sub(header.data_offset)
        .checked_div(dtype.size)
        .unwrap_or(0)
        .min(value_count);
    let mut values = Vec::with_capacity(available_values.min(max_values));
    let mut min: Option<f64> = None;
    let mut max: Option<f64> = None;
    let mut sum = 0.0f64;
    let mut finite_count = 0usize;
    let mut nan_count = 0usize;
    for index in 0..available_values {
        let start = header.data_offset + index * dtype.size;
        let value = read_dtype_value(dtype, &bytes[start..start + dtype.size]);
        if value.is_finite() {
            min = Some(min.map_or(value, |current| current.min(value)));
            max = Some(max.map_or(value, |current| current.max(value)));
            sum += value;
            finite_count += 1;
            if values.len() < max_values {
                values.push(Some(value));
            }
        } else {
            nan_count += 1;
            if values.len() < max_values {
                values.push(None);
            }
        }
    }
    Ok(NumpyArraySummary {
        name: name.to_string(),
        dtype: header.dtype,
        shape: header.shape,
        value_count,
        min,
        max,
        mean: (finite_count > 0).then_some(sum / finite_count as f64),
        nan_count,
        values,
        unsupported: if available_values < value_count {
            Some("array payload is shorter than the declared shape".to_string())
        } else {
            None
        },
    })
}

fn parse_npy_header(bytes: &[u8]) -> Result<NpyHeader, String> {
    if bytes.len() < 10 || !bytes.starts_with(NPY_MAGIC) {
        return Err("invalid NPY magic header".to_string());
    }
    let major = bytes[6];
    let header_length_offset = 8usize;
    let (header_length, data_offset) = match major {
        1 => {
            let length = read_u16_le(bytes, header_length_offset)? as usize;
            (length, 10usize)
        }
        2 | 3 => {
            let length = read_u32_le(bytes, header_length_offset)? as usize;
            (length, 12usize)
        }
        _ => return Err(format!("unsupported NPY version {major}.{}", bytes[7])),
    };
    let header_end = data_offset + header_length;
    if header_end > bytes.len() {
        return Err("truncated NPY header".to_string());
    }
    let header = String::from_utf8_lossy(&bytes[data_offset..header_end]).to_string();
    let dtype = quoted_header_value(&header, "descr")
        .ok_or_else(|| "NPY header is missing descr".to_string())?;
    let shape =
        shape_header_value(&header).ok_or_else(|| "NPY header is missing shape".to_string())?;
    let fortran_order = bool_header_value(&header, "fortran_order").unwrap_or(false);
    Ok(NpyHeader {
        dtype,
        shape,
        fortran_order,
        data_offset: header_end,
    })
}

fn parse_dtype(descr: &str) -> Option<DType> {
    if descr.starts_with('[')
        || descr.contains('O')
        || descr.contains('S')
        || descr.contains('U')
        || descr.contains('c')
    {
        return None;
    }
    let mut chars = descr.chars();
    let first = chars.next()?;
    let (endian, kind_char, rest) = match first {
        '<' => (Endian::Little, chars.next()?, chars.as_str()),
        '>' => (Endian::Big, chars.next()?, chars.as_str()),
        '|' => (Endian::Native, chars.next()?, chars.as_str()),
        '=' => (Endian::Native, chars.next()?, chars.as_str()),
        value => (Endian::Native, value, chars.as_str()),
    };
    let kind = match kind_char {
        'f' => DTypeKind::Float,
        'i' => DTypeKind::Signed,
        'u' => DTypeKind::Unsigned,
        'b' => DTypeKind::Bool,
        '?' => DTypeKind::Bool,
        _ => return None,
    };
    let size = if kind_char == '?' {
        1
    } else {
        rest.parse::<usize>().ok()?
    };
    if size == 0 {
        return None;
    }
    Some(DType { endian, kind, size })
}

fn read_dtype_value(dtype: DType, bytes: &[u8]) -> f64 {
    match (dtype.kind, dtype.size) {
        (DTypeKind::Float, 4) => {
            let raw = [bytes[0], bytes[1], bytes[2], bytes[3]];
            match dtype.endian {
                Endian::Big => f32::from_be_bytes(raw) as f64,
                _ => f32::from_le_bytes(raw) as f64,
            }
        }
        (DTypeKind::Float, 8) => {
            let raw = [
                bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            ];
            match dtype.endian {
                Endian::Big => f64::from_be_bytes(raw),
                _ => f64::from_le_bytes(raw),
            }
        }
        (DTypeKind::Signed, 1) => i8::from_ne_bytes([bytes[0]]) as f64,
        (DTypeKind::Signed, 2) => {
            integer_value::<2, i16>(dtype.endian, bytes, i16::from_le_bytes, i16::from_be_bytes)
                as f64
        }
        (DTypeKind::Signed, 4) => {
            integer_value::<4, i32>(dtype.endian, bytes, i32::from_le_bytes, i32::from_be_bytes)
                as f64
        }
        (DTypeKind::Signed, 8) => {
            integer_value::<8, i64>(dtype.endian, bytes, i64::from_le_bytes, i64::from_be_bytes)
                as f64
        }
        (DTypeKind::Unsigned, 1) => bytes[0] as f64,
        (DTypeKind::Unsigned, 2) => {
            integer_value::<2, u16>(dtype.endian, bytes, u16::from_le_bytes, u16::from_be_bytes)
                as f64
        }
        (DTypeKind::Unsigned, 4) => {
            integer_value::<4, u32>(dtype.endian, bytes, u32::from_le_bytes, u32::from_be_bytes)
                as f64
        }
        (DTypeKind::Unsigned, 8) => {
            integer_value::<8, u64>(dtype.endian, bytes, u64::from_le_bytes, u64::from_be_bytes)
                as f64
        }
        (DTypeKind::Bool, _) => {
            if bytes[0] == 0 {
                0.0
            } else {
                1.0
            }
        }
        _ => f64::NAN,
    }
}

fn integer_value<const N: usize, T: Copy>(
    endian: Endian,
    bytes: &[u8],
    from_le: fn([u8; N]) -> T,
    from_be: fn([u8; N]) -> T,
) -> T {
    let mut raw = [0u8; N];
    raw.copy_from_slice(&bytes[..N]);
    match endian {
        Endian::Big => from_be(raw),
        _ => from_le(raw),
    }
}

fn checked_value_count(shape: &[usize]) -> Result<usize, String> {
    if shape.is_empty() {
        return Ok(1);
    }
    shape.iter().try_fold(1usize, |acc, value| {
        acc.checked_mul(*value)
            .ok_or_else(|| "array shape is too large".to_string())
    })
}

fn quoted_header_value(header: &str, key: &str) -> Option<String> {
    let key_index = header.find(key)?;
    let after_key = &header[key_index + key.len()..];
    let colon_index = after_key.find(':')?;
    let after_colon = &after_key[colon_index + 1..];
    let quote_index = after_colon.find(['\'', '"'])?;
    let quote = after_colon.as_bytes()[quote_index] as char;
    let value_start = key_index + key.len() + colon_index + 1 + quote_index + 1;
    let rest = &header[value_start..];
    let value_end = rest.find(quote)?;
    Some(rest[..value_end].to_string())
}

fn bool_header_value(header: &str, key: &str) -> Option<bool> {
    let key_index = header.find(key)?;
    let after_key = &header[key_index + key.len()..];
    if after_key.contains("True") {
        Some(true)
    } else if after_key.contains("False") {
        Some(false)
    } else {
        None
    }
}

fn shape_header_value(header: &str) -> Option<Vec<usize>> {
    let key_index = header.find("shape")?;
    let after_key = &header[key_index..];
    let open = after_key.find('(')?;
    let close = after_key[open + 1..].find(')')? + open + 1;
    let inside = &after_key[open + 1..close];
    let mut shape = Vec::new();
    for part in inside.split(',') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        shape.push(trimmed.parse::<usize>().ok()?);
    }
    Some(shape)
}

fn read_u16_le(bytes: &[u8], offset: usize) -> Result<u16, String> {
    if offset + 2 > bytes.len() {
        return Err("unexpected end of bytes".to_string());
    }
    Ok(u16::from_le_bytes([bytes[offset], bytes[offset + 1]]))
}

fn read_u32_le(bytes: &[u8], offset: usize) -> Result<u32, String> {
    if offset + 4 > bytes.len() {
        return Err("unexpected end of bytes".to_string());
    }
    Ok(u32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ]))
}

fn read_u64_le(bytes: &[u8], offset: usize) -> Result<u64, String> {
    if offset + 8 > bytes.len() {
        return Err("unexpected end of bytes".to_string());
    }
    Ok(u64::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7],
    ]))
}

fn zip_entry_compressed_size(
    extra: &[u8],
    raw_uncompressed_size: u32,
    raw_compressed_size: u32,
) -> Result<usize, String> {
    if raw_compressed_size != u32::MAX {
        return Ok(raw_compressed_size as usize);
    }
    let mut offset = 0usize;
    while offset + 4 <= extra.len() {
        let tag = read_u16_le(extra, offset)?;
        let size = read_u16_le(extra, offset + 2)? as usize;
        let data_start = offset + 4;
        let data_end = data_start + size;
        if data_end > extra.len() {
            return Err("truncated NPZ extra field".to_string());
        }
        if tag == 0x0001 {
            let mut cursor = data_start;
            if raw_uncompressed_size == u32::MAX {
                cursor += 8;
            }
            let compressed_size = read_u64_le(extra, cursor)?;
            return usize::try_from(compressed_size)
                .map_err(|_| "NPZ entry is too large to preview".to_string());
        }
        offset = data_end;
    }
    Err("NPZ entry uses ZIP64 sizes but has no ZIP64 extra field".to_string())
}

fn trim_npy_suffix(name: &str) -> String {
    name.strip_suffix(".npy").unwrap_or(name).to_string()
}

fn format_shape(shape: &[usize]) -> String {
    if shape.is_empty() {
        return "()".to_string();
    }
    format!(
        "({})",
        shape
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn format_optional(value: Option<f64>) -> String {
    value.map(format_float).unwrap_or_else(|| "-".to_string())
}

fn format_float(value: f64) -> String {
    if value.abs() >= 1000.0 || (value != 0.0 && value.abs() < 0.001) {
        format!("{value:.3e}")
    } else {
        format!("{value:.4}")
    }
}

fn markdown_cell(value: &str) -> String {
    value.replace('|', "\\|")
}

#[cfg(test)]
mod tests {
    use super::{numpy_artifact_text_summary, read_numpy_arrays};
    use std::fs;
    use std::path::PathBuf;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "burette-numpy-artifact-test-{}-{name}",
            uuid::Uuid::new_v4()
        ))
    }

    fn npy_f32(shape: &[usize], values: &[f32]) -> Vec<u8> {
        let mut header = format!(
            "{{'descr': '<f4', 'fortran_order': False, 'shape': ({},), }}",
            shape
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
                .join(", ")
        );
        if shape.len() == 1 {
            header = format!(
                "{{'descr': '<f4', 'fortran_order': False, 'shape': ({},), }}",
                shape[0]
            );
        }
        let prelude_len = 10usize;
        let padding = (16 - ((prelude_len + header.len() + 1) % 16)) % 16;
        header.push_str(&" ".repeat(padding));
        header.push('\n');
        let mut bytes = b"\x93NUMPY\x01\x00".to_vec();
        bytes.extend_from_slice(&(header.len() as u16).to_le_bytes());
        bytes.extend_from_slice(header.as_bytes());
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        bytes
    }

    fn npz_zip64_stored(name: &str, payload: &[u8]) -> Vec<u8> {
        let mut bytes = b"PK\x03\x04".to_vec();
        bytes.extend_from_slice(&45u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&u32::MAX.to_le_bytes());
        bytes.extend_from_slice(&u32::MAX.to_le_bytes());
        bytes.extend_from_slice(&(name.len() as u16).to_le_bytes());
        bytes.extend_from_slice(&20u16.to_le_bytes());
        bytes.extend_from_slice(name.as_bytes());
        bytes.extend_from_slice(&0x0001u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(&(payload.len() as u64).to_le_bytes());
        bytes.extend_from_slice(&(payload.len() as u64).to_le_bytes());
        bytes.extend_from_slice(payload);
        bytes
    }

    #[test]
    fn reads_npy_array_summary() {
        let path = temp_path("plddt.npy");
        fs::write(&path, npy_f32(&[3], &[0.8, 0.9, 1.0])).expect("fixture should write");
        let arrays = read_numpy_arrays(&path, 16).expect("array should parse");
        assert_eq!(arrays.len(), 1);
        assert_eq!(arrays[0].shape, vec![3]);
        assert_eq!(arrays[0].value_count, 3);
        assert_eq!(arrays[0].min, Some(0.800000011920929));
        assert!(arrays[0].mean.expect("mean") > 0.89);
        let summary = numpy_artifact_text_summary(&path, 128).expect("summary should render");
        assert!(summary.contains("NumPy NPY array"));
        assert!(summary.contains("plddt.npy"));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reads_npz_zip64_local_sizes() {
        let path = temp_path("plddt.npz");
        let payload = npy_f32(&[3], &[0.8, 0.9, 1.0]);
        fs::write(&path, npz_zip64_stored("plddt.npy", &payload)).expect("fixture should write");
        let arrays = read_numpy_arrays(&path, 16).expect("npz should parse");
        assert_eq!(arrays.len(), 1);
        assert_eq!(arrays[0].name, "plddt");
        assert_eq!(arrays[0].shape, vec![3]);
        assert!(arrays[0].mean.expect("mean") > 0.89);
        let _ = fs::remove_file(path);
    }
}
