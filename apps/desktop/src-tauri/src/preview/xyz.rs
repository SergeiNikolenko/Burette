pub(crate) struct XyzPayload {
    pub(crate) data: Vec<u8>,
    pub(crate) atom_count: Option<usize>,
    pub(crate) frame_count: Option<usize>,
    pub(crate) comment: Option<String>,
}

pub(crate) fn xyz_first_frame(data: &[u8]) -> Option<XyzPayload> {
    let text = String::from_utf8_lossy(data)
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let lines: Vec<&str> = text.split('\n').collect();
    let mut start = 0;
    while start < lines.len() && lines[start].trim().is_empty() {
        start += 1;
    }
    let atom_count: usize = lines.get(start)?.split_whitespace().next()?.parse().ok()?;
    if atom_count == 0 || start + atom_count + 1 >= lines.len() {
        return None;
    }
    if !has_xyz_atom_lines(&lines, start + 2, atom_count) {
        return None;
    }
    let end = start + atom_count + 2;
    let mut first_frame = lines[start..end].join("\n");
    if !first_frame.ends_with('\n') {
        first_frame.push('\n');
    }
    Some(XyzPayload {
        data: first_frame.into_bytes(),
        atom_count: Some(atom_count),
        frame_count: count_xyz_frames(&lines, start),
        comment: lines.get(start + 1).map(|value| value.to_string()),
    })
}

fn count_xyz_frames(lines: &[&str], mut index: usize) -> Option<usize> {
    let mut frames = 0;
    while index < lines.len() && frames < 100_000 {
        while index < lines.len() && lines[index].trim().is_empty() {
            index += 1;
        }
        let Some(atom_count) = lines
            .get(index)
            .and_then(|line| line.split_whitespace().next())
            .and_then(|value| value.parse::<usize>().ok())
        else {
            break;
        };
        if atom_count == 0 || index + atom_count + 1 >= lines.len() {
            break;
        }
        if !has_xyz_atom_lines(lines, index + 2, atom_count) {
            break;
        }
        frames += 1;
        index += atom_count + 2;
    }
    (frames > 0).then_some(frames)
}

fn has_xyz_atom_lines(lines: &[&str], first_atom_index: usize, atom_count: usize) -> bool {
    let end = first_atom_index + atom_count;
    end <= lines.len()
        && lines[first_atom_index..end]
            .iter()
            .all(|line| !line.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_first_frame_and_counts_frames() {
        let payload = xyz_first_frame(
            b"\n2\nfirst frame\nH 0 0 0\nO 0 0 1\n2\nsecond frame\nH 1 0 0\nO 1 0 1\n",
        )
        .expect("valid xyz should produce a payload");

        assert_eq!(payload.atom_count, Some(2));
        assert_eq!(payload.frame_count, Some(2));
        assert_eq!(payload.comment.as_deref(), Some("first frame"));
        assert_eq!(
            String::from_utf8(payload.data).expect("payload should be utf8"),
            "2\nfirst frame\nH 0 0 0\nO 0 0 1\n"
        );
    }

    #[test]
    fn normalizes_carriage_returns() {
        let payload = xyz_first_frame(b"1\r\ncomment\r\nC 0 0 0\r\n")
            .expect("valid crlf xyz should produce a payload");

        assert_eq!(
            String::from_utf8(payload.data).expect("payload should be utf8"),
            "1\ncomment\nC 0 0 0\n"
        );
    }

    #[test]
    fn rejects_empty_or_incomplete_frames() {
        assert!(xyz_first_frame(b"").is_none());
        assert!(xyz_first_frame(b"0\ncomment\n").is_none());
        assert!(xyz_first_frame(b"2\ncomment\nH 0 0 0\n").is_none());
    }
}
