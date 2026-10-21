use super::*;
use std::cell::RefCell;

struct Fixture(State);
impl Fixture {
    fn new() -> Self {
        Self(State::load(
            std::env::temp_dir()
                .join(format!("burette-statistics-{}", Uuid::new_v4()))
                .join("consent.json"),
            Some("https://statistics.example".into()),
            Some("https://example.org/privacy".into()),
        ))
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(self.0.path.parent().unwrap());
    }
}

#[test]
fn no_collection_identity_or_network_before_explicit_consent() {
    let mut fixture = Fixture::new();
    let state = &mut fixture.0;
    state.record(StatisticsEvent::Active(Activity::Day));
    state
        .flush("2026.10.18", |_, _| panic!("unsolicited request"))
        .unwrap();
    assert!(state.consent.installation_id.is_none());
    assert!(state.pending.is_empty());
    assert!(!state.path.exists());
    state.choose(false).unwrap();
    state.record(StatisticsEvent::Feature(Feature::Editor));
    state
        .flush("2026.10.18", |_, _| panic!("request after refusal"))
        .unwrap();
    let loaded = State::load(
        state.path.clone(),
        state.endpoint.clone(),
        state.notice_url.clone(),
    );
    assert!(loaded.status().decided);
    assert!(!loaded.status().enabled);
}

#[test]
fn consent_persists_id_and_retries_are_idempotent_and_bounded() {
    let mut fixture = Fixture::new();
    let state = &mut fixture.0;
    state.choose(true).unwrap();
    let loaded = State::load(
        state.path.clone(),
        state.endpoint.clone(),
        state.notice_url.clone(),
    );
    assert_eq!(
        state.consent.installation_id,
        loaded.consent.installation_id
    );
    assert!(loaded.status().enabled);
    state.record(StatisticsEvent::Active(Activity::Day));
    state.record(StatisticsEvent::Active(Activity::Day));
    for _ in 0..100 {
        state.record(StatisticsEvent::Feature(Feature::Editor));
    }
    assert_eq!(state.pending.len(), MAX_PENDING);
    let sent = RefCell::new(Vec::new());
    for _ in 0..3 {
        assert!(state
            .flush("2026.10.18", |_, body| {
                sent.borrow_mut().push(body.clone());
                Err("offline".into())
            })
            .is_err());
    }
    assert_eq!(sent.borrow()[0], sent.borrow()[2]);
    assert!(state.batch.is_none());
    state
        .flush("2026.10.18", |_, _| panic!("retry budget exhausted"))
        .unwrap();
}

#[test]
fn withdrawal_clears_pending_data_and_persists_deletion_until_acknowledged() {
    let mut fixture = Fixture::new();
    let state = &mut fixture.0;
    state.choose(true).unwrap();
    let old_id = state.consent.installation_id;
    state.record(StatisticsEvent::Feature(Feature::Editor));
    let _ = state.flush("2026.10.18", |_, _| Err("offline".into()));
    state.choose(false).unwrap();
    assert!(state.batch.is_none() && state.pending.is_empty());
    assert!(state.choose(true).is_err());
    let mut loaded = State::load(
        state.path.clone(),
        state.endpoint.clone(),
        state.notice_url.clone(),
    );
    assert!(loaded.status().pending_erasure && !loaded.status().enabled);
    assert!(loaded
        .flush("2026.10.18", |url, body| {
            assert!(url.ends_with("/erase"));
            assert_eq!(body, &json!({ "installationId": old_id }));
            Err("offline".into())
        })
        .is_err());
    loaded
        .flush("2026.10.18", |_, _| Ok("{\"erased\":true}".into()))
        .unwrap();
    assert!(!loaded.status().pending_erasure);
    assert!(loaded.consent.installation_id.is_none());
    loaded.choose(true).unwrap();
    assert_ne!(old_id, loaded.consent.installation_id);
}

#[test]
fn invalid_old_or_unconfigured_consent_fails_closed() {
    let mut fixture = Fixture::new();
    let state = &mut fixture.0;
    state.choose(true).unwrap();
    state.consent.version = "older".into();
    state.persist(&state.consent).unwrap();
    let loaded = State::load(
        state.path.clone(),
        state.endpoint.clone(),
        state.notice_url.clone(),
    );
    assert!(
        !loaded.status().enabled && !loaded.status().decided && loaded.status().pending_erasure
    );
    fs::write(&state.path, "broken").unwrap();
    let loaded = State::load(
        state.path.clone(),
        state.endpoint.clone(),
        state.notice_url.clone(),
    );
    assert!(!loaded.status().enabled && !loaded.status().decided);
    state.endpoint = None;
    assert!(state.choose(true).is_err());
    for invalid in [
        "http://example.org",
        "https://user:pass@example.org",
        "https://example.org/?key=x",
    ] {
        assert!(https_url(Some(invalid)).is_none());
    }
}

#[test]
fn event_boundary_rejects_raw_data_and_unknown_fields() {
    for value in [
        json!({"kind":"error", "value":"private error"}),
        json!({"kind":"feature", "value":"editor", "filename":"/private/file"}),
        json!({"kind":"active", "value":"day", "stack":"secret"}),
    ] {
        assert!(serde_json::from_value::<StatisticsEvent>(value).is_err());
    }
}

#[test]
fn destination_change_requires_new_consent_and_erases_at_original_service() {
    let mut fixture = Fixture::new();
    fixture.0.choose(true).unwrap();
    let mut loaded = State::load(
        fixture.0.path.clone(),
        Some("https://new.example".into()),
        fixture.0.notice_url.clone(),
    );
    assert!(!loaded.status().enabled && !loaded.status().decided);
    assert!(loaded.choose(true).is_err());
    loaded
        .flush("2026.10.18", |url, _| {
            assert_eq!(url, "https://statistics.example/erase");
            Ok("{\"erased\":true}".into())
        })
        .unwrap();
    loaded.choose(true).unwrap();
    assert_eq!(
        loaded.consent.destination.as_deref(),
        Some("https://new.example")
    );
}

#[test]
fn failed_withdrawal_write_still_stops_collection_and_can_be_retried() {
    let mut fixture = Fixture::new();
    fixture.0.choose(true).unwrap();
    let original = fixture.0.path.clone();
    fixture.0.path = original.join("impossible");
    assert!(fixture.0.choose(false).is_err());
    assert!(!fixture.0.status().enabled && fixture.0.status().pending_erasure);
    assert!(fixture.0.choose(true).is_err());
    fixture.0.path = original;
    fixture
        .0
        .flush("2026.10.18", |_, _| Ok("{\"erased\":true}".into()))
        .unwrap();
    assert!(fixture.0.consent.installation_id.is_none());
}
