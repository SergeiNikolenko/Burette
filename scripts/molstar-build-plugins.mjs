import { molstarSourcePlugin } from './molstar-source.mjs';
import { molstarStatePreconditionPlugin } from './molstar-state-precondition.mjs';
import { molstarDcdTimePlugin } from './molstar-dcd-time.mjs';
import { molstarResizeDrawPlugin } from './molstar-resize-draw.mjs';
import { molstarHoverPickEventsPlugin } from './molstar-hover-pick.mjs';
import { molstarSurfaceLoopPlugin } from './molstar-surface-loop.mjs';
import { molstarSurfaceFieldCachePlugin } from './molstar-surface-field-cache.mjs';

export const molstarBuildPlugins = [molstarSourcePlugin, molstarStatePreconditionPlugin, molstarDcdTimePlugin, molstarResizeDrawPlugin, molstarHoverPickEventsPlugin, molstarSurfaceFieldCachePlugin, molstarSurfaceLoopPlugin];
