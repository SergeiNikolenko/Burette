import { plugin } from 'bun';
import { molstarStatePreconditionPlugin } from '../../scripts/molstar-state-precondition.mjs';
import { molstarLegacySnapshotPlugin } from '../../scripts/molstar-legacy-snapshot.mjs';
plugin(molstarStatePreconditionPlugin);
plugin(molstarLegacySnapshotPlugin);
