//! Identify Mesoscale sessions without materializing a second copy of a MolJ file.
//! The input is already owned by the preview loader. Only bounded parser state
//! and the exact discriminator path are retained; malformed sessions keep the
//! historical Mesoscale fallback.

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Object,
    Array,
    String,
    Other,
}

#[derive(Clone, Copy)]
enum Context {
    Root,
    Entries,
    Entry,
    Snapshot,
    Data,
    Tree,
    Transforms,
    Transform,
    Marker,
    Other,
}

impl Context {
    fn field(self) -> (&'static [u8], Self, Kind) {
        match self {
            Self::Root => (b"entries", Self::Entries, Kind::Array),
            Self::Entry => (b"snapshot", Self::Snapshot, Kind::Object),
            Self::Snapshot => (b"data", Self::Data, Kind::Object),
            Self::Data => (b"tree", Self::Tree, Kind::Object),
            Self::Tree => (b"transforms", Self::Transforms, Kind::Array),
            Self::Transform => (b"transformer", Self::Marker, Kind::String),
            _ => (b"", Self::Other, Kind::Other),
        }
    }
}

struct Parser<'a> {
    data: &'a [u8],
    offset: usize,
}

fn valid_number(bytes: &[u8]) -> bool {
    let mut offset = usize::from(bytes.first() == Some(&b'-'));
    match bytes.get(offset) {
        Some(b'0') => offset += 1,
        Some(b'1'..=b'9') => {
            while matches!(bytes.get(offset), Some(b'0'..=b'9')) {
                offset += 1;
            }
        }
        _ => return false,
    }
    if bytes.get(offset) == Some(&b'.') {
        offset += 1;
        let start = offset;
        while matches!(bytes.get(offset), Some(b'0'..=b'9')) {
            offset += 1;
        }
        if offset == start {
            return false;
        }
    }
    if matches!(bytes.get(offset), Some(b'e' | b'E')) {
        offset += 1;
        if matches!(bytes.get(offset), Some(b'+' | b'-')) {
            offset += 1;
        }
        let start = offset;
        while matches!(bytes.get(offset), Some(b'0'..=b'9')) {
            offset += 1;
        }
        if offset == start {
            return false;
        }
    }
    // core's float parser cannot allocate. serde_json::Number can allocate
    // token-sized scratch when another dependency enables float_roundtrip.
    offset == bytes.len()
        && std::str::from_utf8(bytes)
            .ok()
            .and_then(|text| text.parse::<f64>().ok())
            .is_some_and(f64::is_finite)
}

impl Parser<'_> {
    fn whitespace(&mut self) {
        while matches!(
            self.data.get(self.offset),
            Some(b' ' | b'\n' | b'\r' | b'\t')
        ) {
            self.offset += 1;
        }
    }

    fn take(&mut self, byte: u8) -> Option<()> {
        self.whitespace();
        if self.data.get(self.offset) != Some(&byte) {
            return None;
        }
        self.offset += 1;
        Some(())
    }

    fn hex_quad(&mut self) -> Option<u16> {
        let mut value = 0;
        for _ in 0..4 {
            let digit = (*self.data.get(self.offset)? as char).to_digit(16)? as u16;
            self.offset += 1;
            value = value * 16 + digit;
        }
        Some(value)
    }

    // Every interesting string is short ASCII. Validate all other strings but
    // never allocate them, including arbitrarily long escaped keys and values.
    fn string_matches(&mut self, expected: &[u8]) -> Option<bool> {
        self.take(b'"')?;
        let mut index = 0usize;
        let mut matches = true;
        loop {
            let mut character = *self.data.get(self.offset)? as u16;
            self.offset += 1;
            match character {
                0..=31 => return None,
                34 => return Some(matches && index == expected.len()),
                92 => {
                    let escape = *self.data.get(self.offset)?;
                    self.offset += 1;
                    character = match escape {
                        b'"' => 34,
                        b'\\' => 92,
                        b'/' => 47,
                        b'b' => 8,
                        b'f' => 12,
                        b'n' => 10,
                        b'r' => 13,
                        b't' => 9,
                        b'u' => {
                            let first = self.hex_quad()?;
                            if (0xd800..=0xdbff).contains(&first) {
                                if self.data.get(self.offset..self.offset + 2)? != b"\\u" {
                                    return None;
                                }
                                self.offset += 2;
                                if !(0xdc00..=0xdfff).contains(&self.hex_quad()?) {
                                    return None;
                                }
                            } else if (0xdc00..=0xdfff).contains(&first) {
                                return None;
                            }
                            first
                        }
                        _ => return None,
                    };
                }
                _ => {}
            }
            matches &= expected
                .get(index)
                .is_some_and(|byte| u16::from(*byte) == character);
            // Saturating at the expected length + 1 bounds even the counter.
            index = (index + 1).min(expected.len() + 1);
        }
    }

    fn value(&mut self, context: Context, depth: usize) -> Option<(Kind, bool)> {
        self.whitespace();
        match *self.data.get(self.offset)? {
            b'{' => {
                // serde_json::Value's default recursion budget rejects the
                // 128th nested container. Match it even for ignored subtrees.
                if depth >= 127 {
                    return None;
                }
                self.offset += 1;
                self.whitespace();
                let fallback = matches!(context, Context::Root);
                let mut found = fallback;
                if self.data.get(self.offset) != Some(&b'}') {
                    let (key, child, expected_kind) = context.field();
                    loop {
                        let relevant = self.string_matches(key)? && !key.is_empty();
                        self.take(b':')?;
                        let (kind, result) =
                            self.value(if relevant { child } else { Context::Other }, depth + 1)?;
                        if relevant {
                            // Preserve Value's last-key-wins behavior.
                            found = if kind == expected_kind {
                                result
                            } else {
                                fallback
                            };
                        }
                        self.whitespace();
                        if self.data.get(self.offset) != Some(&b',') {
                            break;
                        }
                        self.offset += 1;
                    }
                }
                self.take(b'}')?;
                Some((Kind::Object, found))
            }
            b'[' => {
                if depth >= 127 {
                    return None;
                }
                self.offset += 1;
                self.whitespace();
                let child = match context {
                    Context::Entries => Context::Entry,
                    Context::Transforms => Context::Transform,
                    _ => Context::Other,
                };
                let mut found = false;
                if self.data.get(self.offset) != Some(&b']') {
                    loop {
                        let (kind, result) = self.value(child, depth + 1)?;
                        found |= kind == Kind::Object && result;
                        self.whitespace();
                        if self.data.get(self.offset) != Some(&b',') {
                            break;
                        }
                        self.offset += 1;
                    }
                }
                self.take(b']')?;
                Some((Kind::Array, found))
            }
            b'"' => Some((
                Kind::String,
                self.string_matches(b"ms-plugin.mesoscale-state")?,
            )),
            b't' | b'f' | b'n' => {
                let literal: &[u8] = match self.data[self.offset] {
                    b't' => b"true",
                    b'f' => b"false",
                    _ => b"null",
                };
                if self.data.get(self.offset..self.offset + literal.len())? != literal {
                    return None;
                }
                self.offset += literal.len();
                Some((Kind::Other, false))
            }
            b'-' | b'0'..=b'9' => {
                let start = self.offset;
                while matches!(
                    self.data.get(self.offset),
                    Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                ) {
                    self.offset += 1;
                }
                if !valid_number(&self.data[start..self.offset]) {
                    return None;
                }
                Some((Kind::Other, false))
            }
            _ => None,
        }
    }
}

/// Whether a MolJ session should use the Mesoscale runtime. Auxiliary memory is
/// bounded by the 127-container nesting limit, independent of entries and bytes.
pub fn is_mesoscale_molj(data: &[u8]) -> bool {
    if std::str::from_utf8(data).is_err() {
        return true;
    }
    let mut parser = Parser { data, offset: 0 };
    let result = parser.value(Context::Root, 0);
    parser.whitespace();
    match result {
        Some((Kind::Object, found)) if parser.offset == data.len() => found,
        _ => true,
    }
}

#[cfg(test)]
#[path = "molj_tests.rs"]
mod tests;
