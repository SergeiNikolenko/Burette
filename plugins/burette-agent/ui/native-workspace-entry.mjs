import { connectViewer } from './mcp-viewer-entry.mjs';
import { startNativeWorkspace } from './native-workspace.mjs';

await connectViewer('burette-native-workspace', startNativeWorkspace);
