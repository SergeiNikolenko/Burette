use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use burrete_compute_protocol::{ClusterV1SubmitRequest, GridScope, MolecularSnapshotRef};
use uuid::Uuid;

use crate::preview::grid_snapshot::{
    plan_grid_scope_snapshot, prepare_grid_scope, FrozenGridSnapshot, SnapshotPublicationRoot,
    SnapshotRootEntry, VerifiedSnapshot,
};

use super::{
    error::{ComputeCoordinatorError, ComputeResult},
    job_factory::VerifiedClusterV1Source,
    store::{
        ComputeStore, SnapshotIntentDraft, SnapshotIntentRecord, SnapshotIntentState,
        SnapshotReconciliationState,
    },
};

#[derive(Debug)]
pub(crate) struct SnapshotRepository {
    root: SnapshotPublicationRoot,
}

impl SnapshotRepository {
    pub(crate) fn initialize(store: &ComputeStore) -> ComputeResult<Self> {
        let directory = store.open_snapshot_directory()?;
        let root = filesystem(SnapshotPublicationRoot::from_compute_directory(directory))?;
        let repository = Self { root };
        repository.reconcile_startup(store)?;
        Ok(repository)
    }

    pub(crate) fn health_check(&self) -> ComputeResult<()> {
        filesystem(self.root.health_check())
    }

    pub(crate) fn publish_grid_source(
        &self,
        store: &ComputeStore,
        database_path: &Path,
        scope: &GridScope,
        snapshot_id: Uuid,
        job_id: Uuid,
        attempt_id: Uuid,
        created_at_ms: u64,
    ) -> ComputeResult<FrozenGridSnapshot> {
        self.health_check()?;
        let plan = filesystem(plan_grid_scope_snapshot(database_path, scope))?;
        let draft = SnapshotIntentDraft {
            snapshot_id,
            job_id,
            attempt_id,
            reservation_bytes: plan.reservation_bytes,
            created_at_ms,
        };
        store.reserve_snapshot_intent(&draft)?;
        let result = (|| {
            store.mark_snapshot_intent_writing(
                snapshot_id,
                attempt_id,
                next_timestamp(created_at_ms, 1)?,
            )?;
            let prepared = filesystem(prepare_grid_scope(
                database_path,
                scope,
                &self.root,
                snapshot_id,
                attempt_id,
                created_at_ms,
            ))?;
            if prepared.reservation_bytes() != plan.reservation_bytes
                || prepared.reference().frozen_source.record_count != plan.record_count
            {
                return Err(protocol(
                    "Grid snapshot changed between reservation and materialization",
                ));
            }
            store.mark_snapshot_intent_synced(
                snapshot_id,
                attempt_id,
                prepared.payload_bytes(),
                prepared.reference(),
                next_timestamp(created_at_ms, 2)?,
            )?;
            let frozen = filesystem(prepared.publish())?;
            store.mark_snapshot_intent_renamed(
                snapshot_id,
                attempt_id,
                next_timestamp(created_at_ms, 3)?,
            )?;
            Ok(frozen)
        })();
        match result {
            Ok(frozen) => Ok(frozen),
            Err(error) => {
                self.cleanup_failed_publication(store, snapshot_id, job_id, attempt_id)?;
                Err(error)
            }
        }
    }

    pub(crate) fn bind_cluster_source(
        &self,
        request: ClusterV1SubmitRequest,
        frozen: FrozenGridSnapshot,
    ) -> ComputeResult<VerifiedClusterV1Source> {
        let FrozenGridSnapshot {
            manifest,
            reference,
            root,
        } = frozen;
        let mut verified = filesystem(root.verify(&reference))?;
        if verified.manifest() != &manifest || verified.reference() != &reference {
            return Err(protocol(
                "published Grid snapshot differs from the materialized source",
            ));
        }
        filesystem(verified.reverify())?;
        Ok(VerifiedClusterV1Source::from_verified_repository(
            request, reference,
        ))
    }

    pub(crate) fn open_verified_source(
        &self,
        reference: &MolecularSnapshotRef,
    ) -> ComputeResult<VerifiedSnapshot> {
        let published = filesystem(self.root.open_published(reference.snapshot_id))?;
        let mut verified = filesystem(published.verify(reference))?;
        filesystem(verified.reverify())?;
        Ok(verified)
    }

    pub(crate) fn rollback_uncommitted_publication(
        &self,
        store: &ComputeStore,
        snapshot_id: Uuid,
        job_id: Uuid,
        attempt_id: Uuid,
    ) -> ComputeResult<()> {
        self.cleanup_failed_publication(store, snapshot_id, job_id, attempt_id)
    }

    fn cleanup_failed_publication(
        &self,
        store: &ComputeStore,
        snapshot_id: Uuid,
        job_id: Uuid,
        attempt_id: Uuid,
    ) -> ComputeResult<()> {
        let intent = store.get_snapshot_intent(snapshot_id)?;
        if intent.job_id != job_id || intent.attempt_id != attempt_id {
            return Err(protocol(
                "snapshot cleanup identity differs from its publication intent",
            ));
        }
        let inventory = InventoryIndex::decode(filesystem(self.root.inventory())?)?;
        self.reconcile_intent(store, &intent, &inventory)
    }

    pub(crate) fn reconcile_startup(&self, store: &ComputeStore) -> ComputeResult<()> {
        self.health_check()?;
        let database = store.snapshot_reconciliation_state()?;
        let inventory = InventoryIndex::decode(filesystem(self.root.inventory())?)?;

        for snapshot_id in database.committed_sources.keys() {
            if database
                .intents
                .iter()
                .any(|intent| intent.snapshot_id == *snapshot_id)
            {
                return Err(protocol(format!(
                    "committed snapshot {snapshot_id} still has a publication intent"
                )));
            }
            if inventory.staging.contains_key(snapshot_id) {
                return Err(protocol(format!(
                    "committed snapshot {snapshot_id} still has staging state"
                )));
            }
            if !inventory.published.contains(snapshot_id) {
                return Err(protocol(format!(
                    "committed snapshot {snapshot_id} is missing from the filesystem"
                )));
            }
        }

        for (snapshot_id, expected) in &database.committed_sources {
            let published = filesystem(self.root.open_published(*snapshot_id))?;
            let _verified = filesystem(published.verify(expected))?;
        }

        for intent in &database.intents {
            self.reconcile_intent(store, intent, &inventory)?;
        }

        let intent_ids = database
            .intents
            .iter()
            .map(|intent| intent.snapshot_id)
            .collect::<BTreeSet<_>>();
        for (snapshot_id, attempts) in &inventory.staging {
            if database.committed_sources.contains_key(snapshot_id)
                || intent_ids.contains(snapshot_id)
            {
                continue;
            }
            for attempt_id in attempts {
                filesystem(self.root.cleanup_staging(*snapshot_id, *attempt_id))?;
            }
        }
        for snapshot_id in &inventory.published {
            if database.committed_sources.contains_key(snapshot_id)
                || intent_ids.contains(snapshot_id)
            {
                continue;
            }
            let published = filesystem(self.root.open_published(*snapshot_id))?;
            let verified = filesystem(published.verify_observed())?;
            filesystem(self.root.remove_verified(verified, Uuid::new_v4()))?;
        }

        self.require_postcondition(store, &database)
    }

    fn reconcile_intent(
        &self,
        store: &ComputeStore,
        intent: &SnapshotIntentRecord,
        inventory: &InventoryIndex,
    ) -> ComputeResult<()> {
        let published = inventory.published.contains(&intent.snapshot_id);
        let attempts = inventory.staging.get(&intent.snapshot_id);
        if let Some(attempts) = attempts {
            if attempts.len() != 1 || !attempts.contains(&intent.attempt_id) {
                return Err(protocol(format!(
                    "snapshot intent {} has unexpected staging attempts",
                    intent.snapshot_id
                )));
            }
        }
        if published && attempts.is_some() {
            return Err(protocol(format!(
                "snapshot intent {} has both final and staging state",
                intent.snapshot_id
            )));
        }

        if attempts.is_some() {
            filesystem(
                self.root
                    .cleanup_staging(intent.snapshot_id, intent.attempt_id),
            )?;
        } else if published {
            let published = filesystem(self.root.open_published(intent.snapshot_id))?;
            let verified = match intent.state {
                SnapshotIntentState::Reserved | SnapshotIntentState::Writing => {
                    filesystem(published.verify_observed())?
                }
                SnapshotIntentState::Synced | SnapshotIntentState::Renamed => {
                    let expected = intent.snapshot_ref.as_ref().ok_or_else(|| {
                        protocol(format!(
                            "synced snapshot intent {} is missing its reference",
                            intent.snapshot_id
                        ))
                    })?;
                    filesystem(published.verify(expected))?
                }
            };
            self.remove_intent_final(verified, intent.attempt_id)?;
        }

        store.delete_snapshot_intent_after_cleanup(intent)
    }

    fn remove_intent_final(
        &self,
        verified: VerifiedSnapshot,
        attempt_id: Uuid,
    ) -> ComputeResult<()> {
        filesystem(self.root.remove_verified(verified, attempt_id))
    }

    fn require_postcondition(
        &self,
        store: &ComputeStore,
        initial: &SnapshotReconciliationState,
    ) -> ComputeResult<()> {
        self.health_check()?;
        let final_database = store.snapshot_reconciliation_state()?;
        if !final_database.intents.is_empty() {
            return Err(protocol(
                "snapshot reconciliation left publication intents behind",
            ));
        }
        if final_database.committed_sources != initial.committed_sources {
            return Err(protocol(
                "committed snapshot references changed during startup reconciliation",
            ));
        }

        let final_inventory = filesystem(self.root.inventory())?;
        let expected = initial
            .committed_sources
            .keys()
            .copied()
            .map(|snapshot_id| SnapshotRootEntry::Published { snapshot_id })
            .collect::<Vec<_>>();
        if final_inventory != expected {
            return Err(protocol(
                "snapshot filesystem differs from the committed source set after reconciliation",
            ));
        }
        for (snapshot_id, expected) in &initial.committed_sources {
            let published = filesystem(self.root.open_published(*snapshot_id))?;
            let mut verified = filesystem(published.verify(expected))?;
            filesystem(verified.reverify())?;
        }
        self.health_check()
    }
}

#[derive(Debug)]
struct InventoryIndex {
    published: BTreeSet<Uuid>,
    staging: BTreeMap<Uuid, BTreeSet<Uuid>>,
}

impl InventoryIndex {
    fn decode(entries: Vec<SnapshotRootEntry>) -> ComputeResult<Self> {
        let mut published = BTreeSet::new();
        let mut staging = BTreeMap::<Uuid, BTreeSet<Uuid>>::new();
        for entry in entries {
            match entry {
                SnapshotRootEntry::Published { snapshot_id } => {
                    if !published.insert(snapshot_id) {
                        return Err(protocol(format!(
                            "snapshot inventory repeats published snapshot {snapshot_id}"
                        )));
                    }
                }
                SnapshotRootEntry::Staging {
                    snapshot_id,
                    attempt_id,
                } => {
                    if !staging.entry(snapshot_id).or_default().insert(attempt_id) {
                        return Err(protocol(format!(
                            "snapshot inventory repeats staging attempt {attempt_id}"
                        )));
                    }
                }
            }
        }
        Ok(Self { published, staging })
    }
}

fn filesystem<T>(result: Result<T, String>) -> ComputeResult<T> {
    result.map_err(ComputeCoordinatorError::Filesystem)
}

fn protocol(message: impl Into<String>) -> ComputeCoordinatorError {
    ComputeCoordinatorError::Protocol(message.into())
}

fn next_timestamp(created_at_ms: u64, increment: u64) -> ComputeResult<u64> {
    created_at_ms.checked_add(increment).ok_or_else(|| {
        ComputeCoordinatorError::Validation("snapshot publication timestamp overflowed".into())
    })
}

#[cfg(all(test, unix))]
mod tests {
    use std::{fs, os::unix::fs::PermissionsExt, path::PathBuf};

    use burrete_compute_protocol::{GridScope, SelectedGridScope};

    use super::*;
    use crate::{
        compute::store::{
            test_support::{insert_prepared_fixture, queued_snapshot},
            SnapshotIntentDraft,
        },
        preview::{grid_snapshot::freeze_grid_scope, grid_store::build_grid_store},
        windows::MAIN_WINDOW_LABEL,
    };

    struct TestStore {
        root: PathBuf,
        store: ComputeStore,
    }

    impl TestStore {
        fn new() -> Self {
            let root = std::env::temp_dir()
                .canonicalize()
                .expect("canonical temporary directory")
                .join(format!("burrete-snapshot-repository-{}", Uuid::new_v4()));
            let store = ComputeStore::initialize(root.clone()).expect("initialize compute store");
            Self { root, store }
        }

        fn reserve(&self) -> SnapshotIntentRecord {
            let draft = SnapshotIntentDraft {
                snapshot_id: Uuid::new_v4(),
                job_id: Uuid::new_v4(),
                attempt_id: Uuid::new_v4(),
                reservation_bytes: 4_096,
                created_at_ms: 100,
            };
            self.store
                .reserve_snapshot_intent(&draft)
                .expect("reserve snapshot intent")
        }

        fn create_empty_staging(&self, snapshot_id: Uuid, attempt_id: Uuid) {
            let child = self
                .store
                .open_snapshot_directory()
                .expect("open snapshots directory");
            let path = child
                .path()
                .join(format!(".snapshot-{snapshot_id}.staging-{attempt_id}"));
            fs::create_dir(&path).expect("create empty staging directory");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                .expect("make staging directory private");
        }

        fn publish_committed_snapshot(
            &self,
            repository: &SnapshotRepository,
        ) -> burrete_compute_protocol::JobSnapshot {
            let reference = self.publish_snapshot(repository);
            let mut snapshot = queued_snapshot();
            snapshot.frozen_source = reference;
            snapshot.validate().expect("valid committed snapshot job");
            insert_prepared_fixture(&self.store, MAIN_WINDOW_LABEL, &snapshot);
            snapshot
        }

        fn publish_snapshot(
            &self,
            repository: &SnapshotRepository,
        ) -> burrete_compute_protocol::MolecularSnapshotRef {
            let grid_root = self.root.join(format!("grid-fixture-{}", Uuid::new_v4()));
            fs::create_dir_all(&grid_root).expect("create Grid fixture root");
            let database = build_grid_store(&grid_root, "smi", b"CC Ethane\nO Water\n")
                .expect("build Grid fixture")
                .expect("create Grid fixture")
                .database_path;
            let frozen = freeze_grid_scope(
                &database,
                &GridScope::Selected(SelectedGridScope {
                    source_indexes: vec![0, 1],
                }),
                &repository.root,
                Uuid::new_v4(),
                Uuid::new_v4(),
                100,
            )
            .expect("freeze committed source");
            frozen.reference
        }
    }

    impl Drop for TestStore {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn initializes_an_empty_repository_and_cleans_intent_without_files() {
        let test = TestStore::new();
        let intent = test.reserve();

        let repository =
            SnapshotRepository::initialize(&test.store).expect("initialize snapshot repository");
        repository.health_check().expect("healthy repository");
        assert!(test
            .store
            .snapshot_intents_for_reconciliation()
            .expect("read reconciled intents")
            .is_empty());
        assert!(!repository
            .root
            .destination_path(intent.snapshot_id)
            .exists());
    }

    #[test]
    fn publishes_grid_source_through_every_durable_intent_boundary() {
        let test = TestStore::new();
        let repository =
            SnapshotRepository::initialize(&test.store).expect("initialize snapshot repository");
        let grid_root = test.root.join(format!("grid-publish-{}", Uuid::new_v4()));
        fs::create_dir_all(&grid_root).expect("create Grid fixture root");
        let database = build_grid_store(&grid_root, "smi", b"CC Ethane\nO Water\n")
            .expect("build Grid fixture")
            .expect("create Grid fixture")
            .database_path;
        let snapshot_id = Uuid::new_v4();
        let job_id = Uuid::new_v4();
        let attempt_id = Uuid::new_v4();
        let frozen = repository
            .publish_grid_source(
                &test.store,
                &database,
                &GridScope::Selected(SelectedGridScope {
                    source_indexes: vec![0, 1],
                }),
                snapshot_id,
                job_id,
                attempt_id,
                100,
            )
            .expect("publish durable Grid source");
        let intent = test
            .store
            .get_snapshot_intent(snapshot_id)
            .expect("load renamed snapshot intent");
        assert_eq!(intent.state, SnapshotIntentState::Renamed);
        assert_eq!(intent.snapshot_ref.as_ref(), Some(&frozen.reference));
        assert_eq!(intent.remaining_reservation_bytes, 0);
        assert!(intent.actual_payload_bytes.is_some_and(|bytes| bytes > 0));
        assert_eq!(
            repository.root.inventory().expect("published inventory"),
            vec![SnapshotRootEntry::Published { snapshot_id }]
        );
    }

    #[test]
    fn cleans_only_the_exact_intent_staging_pair() {
        let test = TestStore::new();
        let intent = test.reserve();
        test.create_empty_staging(intent.snapshot_id, intent.attempt_id);

        SnapshotRepository::initialize(&test.store).expect("reconcile exact staging intent pair");
        assert!(test
            .store
            .snapshot_intents_for_reconciliation()
            .expect("read reconciled intents")
            .is_empty());
    }

    #[test]
    fn fails_closed_for_a_different_staging_attempt() {
        let test = TestStore::new();
        let intent = test.reserve();
        test.create_empty_staging(intent.snapshot_id, Uuid::new_v4());

        assert!(matches!(
            SnapshotRepository::initialize(&test.store),
            Err(ComputeCoordinatorError::Protocol(_))
        ));
        assert_eq!(
            test.store
                .snapshot_intents_for_reconciliation()
                .expect("intent remains after failed reconciliation"),
            vec![intent]
        );
    }

    #[test]
    fn attached_repository_detects_snapshots_entry_replacement() {
        let test = TestStore::new();
        let repository =
            SnapshotRepository::initialize(&test.store).expect("initialize snapshot repository");
        let snapshots = test.root.join("snapshots");
        let displaced = test.root.join("displaced-snapshots");
        fs::rename(&snapshots, &displaced).expect("displace attached snapshots directory");
        fs::create_dir(&snapshots).expect("create replacement snapshots directory");
        fs::set_permissions(&snapshots, fs::Permissions::from_mode(0o700))
            .expect("make replacement snapshots directory private");

        assert!(matches!(
            repository.health_check(),
            Err(ComputeCoordinatorError::Filesystem(_))
        ));
    }

    #[test]
    fn retains_one_verified_final_shared_by_multiple_committed_jobs() {
        let test = TestStore::new();
        let repository =
            SnapshotRepository::initialize(&test.store).expect("initialize snapshot repository");
        let first = test.publish_committed_snapshot(&repository);
        let mut second = first.clone();
        second.job_id = Uuid::new_v4();
        second.validate().expect("valid shared-source job");
        insert_prepared_fixture(&test.store, MAIN_WINDOW_LABEL, &second);
        drop(repository);

        let reopened = SnapshotRepository::initialize(&test.store)
            .expect("reconcile shared committed snapshot");
        let state = test
            .store
            .snapshot_reconciliation_state()
            .expect("read committed sources");
        assert_eq!(state.committed_sources.len(), 1);
        assert_eq!(
            filesystem(reopened.root.inventory()).expect("inventory shared snapshot"),
            vec![SnapshotRootEntry::Published {
                snapshot_id: first.frozen_source.snapshot_id,
            }]
        );
    }

    #[test]
    fn fails_closed_when_a_committed_final_is_missing() {
        let test = TestStore::new();
        let repository =
            SnapshotRepository::initialize(&test.store).expect("initialize snapshot repository");
        let snapshot = test.publish_committed_snapshot(&repository);
        let published = filesystem(
            repository
                .root
                .open_published(snapshot.frozen_source.snapshot_id),
        )
        .expect("open committed final");
        let verified = filesystem(published.verify(&snapshot.frozen_source))
            .expect("verify committed final before removal");
        filesystem(repository.root.remove_verified(verified, Uuid::new_v4()))
            .expect("simulate missing committed final");
        drop(repository);

        assert!(matches!(
            SnapshotRepository::initialize(&test.store),
            Err(ComputeCoordinatorError::Protocol(_))
        ));
    }

    #[test]
    fn rolls_back_a_final_from_every_uncommitted_intent_state() {
        for target_state in [
            SnapshotIntentState::Reserved,
            SnapshotIntentState::Writing,
            SnapshotIntentState::Synced,
            SnapshotIntentState::Renamed,
        ] {
            let test = TestStore::new();
            let repository = SnapshotRepository::initialize(&test.store)
                .expect("initialize snapshot repository");
            let reference = test.publish_snapshot(&repository);
            let draft = SnapshotIntentDraft {
                snapshot_id: reference.snapshot_id,
                job_id: Uuid::new_v4(),
                attempt_id: Uuid::new_v4(),
                reservation_bytes: 4_096,
                created_at_ms: 100,
            };
            test.store
                .reserve_snapshot_intent(&draft)
                .expect("reserve final intent");
            if matches!(
                target_state,
                SnapshotIntentState::Writing
                    | SnapshotIntentState::Synced
                    | SnapshotIntentState::Renamed
            ) {
                test.store
                    .mark_snapshot_intent_writing(draft.snapshot_id, draft.attempt_id, 101)
                    .expect("mark final intent writing");
            }
            if matches!(
                target_state,
                SnapshotIntentState::Synced | SnapshotIntentState::Renamed
            ) {
                test.store
                    .mark_snapshot_intent_synced(
                        draft.snapshot_id,
                        draft.attempt_id,
                        1_024,
                        &reference,
                        102,
                    )
                    .expect("mark final intent synced");
            }
            if target_state == SnapshotIntentState::Renamed {
                test.store
                    .mark_snapshot_intent_renamed(draft.snapshot_id, draft.attempt_id, 103)
                    .expect("mark final intent renamed");
            }
            drop(repository);

            let reconciled =
                SnapshotRepository::initialize(&test.store).expect("roll back uncommitted final");
            assert!(test
                .store
                .snapshot_intents_for_reconciliation()
                .expect("read rolled-back intent")
                .is_empty());
            assert!(filesystem(reconciled.root.inventory())
                .expect("inventory rolled-back final")
                .is_empty());
        }
    }
}
