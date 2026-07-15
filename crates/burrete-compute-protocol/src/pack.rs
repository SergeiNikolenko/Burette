mod common;
mod engine;
mod layout;
mod molecular;
mod records;
mod result;

pub use common::{
    EnginePackVersion, MolecularSnapshotVersion, MAX_JSON_SAFE_INTEGER, MAX_PACK_ARRAYS,
    MAX_PACK_BYTES, MAX_PACK_FILES, MAX_PACK_RECORDS,
};
pub use engine::{EnginePackManifest, EnginePackRef};
pub use layout::{
    PackedArrayDescriptor, PackedByteOrder, PackedDType, PackedFileDescriptor, PackedLayout,
};
pub use molecular::{
    FrozenSourceIdentity, MolecularSnapshotManifest, MolecularSnapshotRef,
    MOLECULE_CONTENT_HASHES_ARRAY_NAME, MOLECULE_CONTENT_HASHES_SEMANTIC,
    SOURCE_RECORD_IDS_ARRAY_NAME, SOURCE_RECORD_IDS_SEMANTIC,
};
pub use records::{
    MolecularSnapshotRecordV1, MolecularSnapshotRecordVersion, OrderedRecordMoleculeIdentityHasher,
    MOLECULAR_RECORDS_FILE_NAME, MOLECULAR_RECORDS_FILE_PATH, MOLECULAR_RECORDS_MEDIA_TYPE,
    ORDERED_RECORD_MOLECULE_IDENTITY_DOMAIN,
};
pub use result::{ResultPackManifest, ResultPackRef};

#[cfg(test)]
mod tests;
