use super::is_mesoscale_molj;
use serde_json::{json, Value};

const ENTRY: &str = r#"{"snapshot":{"data":{"tree":{"transforms":[{"transformer":"ms-plugin.mesoscale-state"}]}}}}"#;

fn original(data: &[u8]) -> bool {
    serde_json::from_slice::<Value>(data)
        .ok()
        .and_then(|session| session.get("entries").and_then(Value::as_array).cloned())
        .is_none_or(|entries| {
            entries.iter().any(|entry| {
                entry
                    .pointer("/snapshot/data/tree/transforms")
                    .and_then(Value::as_array)
                    .is_some_and(|transforms| {
                        transforms.iter().any(|transform| {
                            transform.get("transformer").and_then(Value::as_str)
                                == Some("ms-plugin.mesoscale-state")
                        })
                    })
            })
        })
}

fn agrees(data: &[u8]) {
    assert_eq!(
        is_mesoscale_molj(data),
        original(data),
        "{}",
        String::from_utf8_lossy(&data[..data.len().min(300)])
    );
}

#[test]
fn session_shapes_escapes_and_last_duplicate_keys_match_original() {
    for value in [
        json!(null),
        json!(false),
        json!(42),
        json!([]),
        json!({}),
        json!({"entries": null}),
        json!({"entries": []}),
        json!({"entries": [null, 1, [], {}]}),
        json!({"entries": [{"snapshot":{"data":{"tree":{"transforms":[
            {"transformer":"ms-plugin.mesoscale-state"}]
        }}}}]}),
    ] {
        agrees(&serde_json::to_vec(&value).unwrap());
    }
    let session = format!(r#"{{"entries":[{ENTRY}]}}"#);
    assert!(is_mesoscale_molj(session.as_bytes()));
    assert!(!is_mesoscale_molj(br#"{"entries":[]}"#));
    for text in [
        session.clone(),
        session
            .replace("entries", r"entr\u0069es")
            .replace("mesoscale", r"meso\u0073cale"),
        format!(r#"{{"entries":[{ENTRY}],"entries":[]}}"#),
        format!(r#"{{"entries":[],"entries":[{ENTRY}]}}"#),
        format!(r#"{{"entries":[{ENTRY}],"entries":null}}"#),
        format!(r#"{{"entries":[],"unrelated":[{ENTRY}]}}"#),
        session.replace(
            r#""snapshot":{"data""#,
            r#""snapshot":{},"snapshot":{"data""#,
        ),
        session.replace(
            r#""tree":{"transforms""#,
            r#""tree":null,"tree":{"transforms""#,
        ),
        session.replace(
            r#""transformer":"ms-plugin.mesoscale-state""#,
            r#""transformer":"ms-plugin.mesoscale-state","transformer":false"#,
        ),
        session.replace(r#""transforms":["#, r#""transforms":[],"transforms":["#),
    ] {
        agrees(text.as_bytes());
    }
    // Wrong shapes at every path segment must not inherit a deeper marker.
    let mut child: Value = json!("ms-plugin.mesoscale-state");
    for key in [
        "transformer",
        "transforms",
        "tree",
        "data",
        "snapshot",
        "entries",
    ] {
        child = if key == "transforms" || key == "entries" {
            json!({key: [child]})
        } else {
            json!({key: child})
        };
        for wrong in [
            json!(null),
            json!([child.clone()]),
            json!({"unrelated":child.clone()}),
        ] {
            agrees(&serde_json::to_vec(&wrong).unwrap());
        }
    }
}

#[test]
fn malformed_tail_unicode_numbers_and_depth_preserve_fallback() {
    for token in [
        r#""\ud800""#,
        r#""\udc00""#,
        r#""\ud800\u0041""#,
        r#""\ud800\udc00""#,
        r#""\u00e9""#,
        r#""é🧪""#,
        r#""\uXYZW""#,
        r#""\x22""#,
        r#""\b\f\n\r\t\/\\\"""#,
        "1e99999",
        "0e99999",
        "-0e99999",
        "1.7976931348623157e308",
        "1.7976931348623159e308",
        "1e-99999",
        "012",
        "1.",
        "+1",
        "--1",
        "1e+",
        "NaN",
        "truex",
        "",
        "[1,]",
        "{\"a\":1,}",
    ] {
        agrees(format!(r#"{{"entries":[],"ignored":{token}}}"#).as_bytes());
        agrees(format!(r#"{{"ignored":{token},"entries":[]}}"#).as_bytes());
    }
    for suffix in ["x", "[]", ",", "\0", "\u{b}", " "] {
        agrees(format!(r#"{{"entries":[]}}{suffix}"#).as_bytes());
    }
    agrees(b"{\"entries\":[],\"ignored\":\"\xff\"}");
    agrees(b"{\"entries\":[],\"ignored\":\"\x01\"}");
    for depth in 120..132 {
        agrees(
            format!(
                r#"{{"entries":[],"ignored":{}0{}}}"#,
                "[".repeat(depth),
                "]".repeat(depth)
            )
            .as_bytes(),
        );
    }
}

#[test]
fn late_marker_and_large_ignored_tokens_do_not_require_a_tree() {
    let payload = "\\u0061".repeat(1_000_000);
    // Both a giant escaped map key and value: no serde scratch String retained.
    let data = format!(r#"{{"{payload}":"{payload}","entries":[{ENTRY}]}}"#);
    assert!(is_mesoscale_molj(data.as_bytes()));
    let data = format!(r#"{{"{payload}":"{payload}","entries":[]}}"#);
    assert!(!is_mesoscale_molj(data.as_bytes()));
    let data = format!(r#"{{"entries":[{}{ENTRY}]}}"#, "{},".repeat(100_000));
    assert!(is_mesoscale_molj(data.as_bytes()));
    assert!(is_mesoscale_molj(format!("{data}broken").as_bytes()));
    for number in [
        format!("1.{}", "1".repeat(1_000_000)),
        format!("0e{}", "9".repeat(1_000_000)),
        format!("1e-{}", "9".repeat(1_000_000)),
    ] {
        assert!(!is_mesoscale_molj(
            format!(r#"{{"entries":[],"number":{number}}}"#).as_bytes()
        ));
    }
}

#[test]
fn every_truncation_and_single_byte_mutation_matches_value_parser() {
    let sample = format!(
        r#"{{"entries":[],"payload":[null,true,false,-1.2e3,"\uD83E\uDDEA","é"],"other":{ENTRY}}}"#
    );
    for end in 0..=sample.len() {
        agrees(&sample.as_bytes()[..end]);
    }
    for index in 0..sample.len() {
        for byte in [b'"', b'\\', b':', b',', b'}', b']', b'0', b'\n', 0xff] {
            let mut mutated = sample.as_bytes().to_vec();
            mutated[index] = byte;
            agrees(&mutated);
        }
    }
}
