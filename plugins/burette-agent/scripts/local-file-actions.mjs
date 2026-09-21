import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const readAppIcon = `ObjC.import("AppKit"); function run(argv) {
  const workspace = $.NSWorkspace.sharedWorkspace;
  const path = argv[1] === 'finder' ? '/System/Library/CoreServices/Finder.app'
    : argv[1] === 'default' ? ObjC.unwrap(workspace.URLForApplicationToOpenURL($.NSURL.fileURLWithPath(argv[0])).path) : argv[1];
  const icon = workspace.iconForFile(path);
  const bitmap = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(null, 32, 32, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
  $.NSGraphicsContext.saveGraphicsState;
  $.NSGraphicsContext.setCurrentContext($.NSGraphicsContext.graphicsContextWithBitmapImageRep(bitmap));
  icon.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, 32, 32), $.NSZeroRect, $.NSCompositingOperationCopy, 1);
  $.NSGraphicsContext.restoreGraphicsState;
  return ObjC.unwrap(bitmap.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({})).base64EncodedStringWithOptions(0));
}`;
// Fixed program: file names are argv values, never AppleScript/JavaScript source.
const discoverApps = `ObjC.import("AppKit"); function run(argv) {
  const urls = $.NSWorkspace.sharedWorkspace.URLsForApplicationsToOpenURL($.NSURL.fileURLWithPath(argv[0]));
  const apps = [];
  for (let i = 0; i < Math.min(Number(urls.count), 40); i++) {
    const url = urls.objectAtIndex(i);
    const bundle = $.NSBundle.bundleWithURL(url);
    apps.push({ appPath: ObjC.unwrap(url.path), name: ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(url.path)), bundleId: ObjC.unwrap(bundle.bundleIdentifier) });
  }
  return JSON.stringify(apps);
}`;

/** Caller supplies its existing session's path authorization boundary. */
export async function localFileAction(input, { authorize, platform = process.platform, execute = runFile }) {
  if (!['list_apps', 'app_icon', 'reveal', 'open_default', 'open_with'].includes(input.type)) throw new Error('Unsupported file action.');
  const path = await realpath(input.path);
  if (!await authorize(path) || !(await stat(path)).isFile()) throw new Error('File is not authorized for this workspace.');
  if (platform !== 'darwin') {
    if (input.type === 'list_apps') return { targets: [], supported: false };
    throw new Error('Finder and Open With require macOS.');
  }
  const options = { timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' };
  const icon = async target => {
    const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', readAppIcon, path, target], options);
    const png = stdout.trim();
    if (png.length > 16384 || !/^iVBORw0KGgo[A-Za-z0-9+/=]+$/u.test(png)) throw new Error('Invalid application icon.');
    return { iconUrl: `data:image/png;base64,${png}` };
  };
  if (input.type === 'app_icon' && ['finder', 'default'].includes(input.targetId)) return icon(input.targetId);
  if (input.type === 'reveal' || input.type === 'open_default') {
    await execute('/usr/bin/open', [...(input.type === 'reveal' ? ['-R'] : []), path], options);
    return { ok: true };
  }
  const { stdout } = await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', discoverApps, path], options);
  const apps = JSON.parse(stdout);
  if (!Array.isArray(apps) || apps.length > 40) throw new Error('Invalid application discovery result.');
  const targets = apps.filter(app => typeof app.appPath === 'string' && app.appPath.endsWith('.app') && typeof app.name === 'string')
    .map((app, index) => ({ ...app,
      id: createHash('sha256').update(app.appPath).digest('hex').slice(0, 24), rank: index,
      supportedExtensions: [extname(path).slice(1).toLowerCase()], matchReason: 'Registered macOS application',
    }));
  if (input.type === 'list_apps') return { targets, supported: true };
  const target = targets.find(app => app.id === input.targetId);
  if (!target) throw new Error('Application is not registered for this file. Refresh Open With.');
  if (input.type === 'app_icon') return icon(target.appPath);
  await execute('/usr/bin/open', ['-a', target.appPath, path], options);
  return { ok: true };
}
