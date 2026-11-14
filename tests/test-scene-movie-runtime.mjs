// Movie recording against a real Mol* camera. The browser's H.264 encoder does not
// exist here, so a stand-in emits one length-tagged sample per frame; the MP4 writer,
// the frame schedule, cancellation and the camera spin are the viewer's own code.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Camera } from '@molstar/graphics/canvas3d/camera';
import { Viewport } from '@molstar/graphics/canvas3d/camera/util';

const description = Uint8Array.of(1, 66, 0, 51, 255, 225, 0, 0);
const encoded = [];
class VideoEncoder {
  static isConfigSupported() { return Promise.resolve({ supported: true }); }
  constructor(init) { this.init = init; this.state = 'unconfigured'; this.encodeQueueSize = 0; this.count = 0; }
  configure(config) { this.config = config; this.state = 'configured'; }
  encode(frame, options) {
    const index = this.count++, bytes = Uint8Array.from({ length: 4 + index % 5 }, (_, offset) => (index + offset) & 255);
    encoded.push({ timestamp: frame.options.timestamp, visibleRect: frame.options.visibleRect, key: options.keyFrame });
    this.init.output({ byteLength: bytes.length, type: options.keyFrame ? 'key' : 'delta', copyTo: target => target.set(bytes) },
      index ? {} : { decoderConfig: { description } });
  }
  flush() { return Promise.resolve(); }
  close() { this.state = 'closed'; }
}
class VideoFrame { constructor(canvas, options) { this.options = options; } close() {} }

const camera = new Camera();
Viewport.set(camera.viewport, 0, 0, 201, 151);
camera.setState({ position: [0, 0, 25], target: [0, 0, 0], up: [0, 1, 0] }, 0);
camera.update();
const plugin = { canvas3dContext: { canvas: { width: 201, height: 151 } }, canvas3d: { camera, requestDraw() {} } };
const window = {};
vm.runInNewContext(readFileSync(new URL('../PreviewExtension/Web/scene-media.js', import.meta.url), 'utf8'), {
  window, VideoEncoder, VideoFrame, Blob, performance, setTimeout, requestAnimationFrame: callback => setTimeout(callback, 0),
});
const media = window.BuretteSceneMedia;
const position = () => Array.from(camera.getSnapshot().position).map(value => Number(value.toFixed(6)));

// ISO BMFF boxes by path; container boxes are walked.
function boxes(bytes, start = 0, end = bytes.length, path = '', out = new Map()) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = start; at < end;) {
    const size = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4, at + 8)), name = `${path}/${type}`;
    assert.ok(size >= 8 && at + size <= end, `${name} fits its parent`);
    out.set(name, { at, size, view: new DataView(bytes.buffer, bytes.byteOffset + at + 8, size - 8) });
    if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) boxes(bytes, at + 8, at + size, name, out);
    at += size;
  }
  return out;
}

// Three seconds at 24 fps from an odd-sized canvas: 72 samples of an even-sized picture.
const movie = await media.record(plugin, { seconds: 3, fps: 24, spin: true });
assert.equal(movie.type, 'video/mp4');
const bytes = new Uint8Array(await movie.blob.arrayBuffer()), found = boxes(bytes);
assert.deepEqual([...found.keys()].filter(name => name.split('/').length === 2), ['/ftyp', '/moov', '/mdat']);
assert.equal(found.get('/ftyp').size + found.get('/moov').size + found.get('/mdat').size, bytes.length);
const stbl = name => found.get(`/moov/trak/mdia/minf/stbl/${name}`).view;
const sizes = Array.from({ length: 72 }, (_, index) => 4 + index % 5);
assert.equal(stbl('stsz').getUint32(8), 72);
assert.deepEqual(Array.from({ length: 72 }, (_, index) => stbl('stsz').getUint32(12 + 4 * index)), sizes);
assert.deepEqual([stbl('stts').getUint32(4), stbl('stts').getUint32(8), stbl('stts').getUint32(12)], [1, 72, 1], 'one duration for every sample');
assert.deepEqual([stbl('stss').getUint32(4), stbl('stss').getUint32(8), stbl('stss').getUint32(12)], [2, 1, 49], 'a key frame every two seconds');
assert.deepEqual([stbl('stsc').getUint32(8), stbl('stsc').getUint32(12)], [1, 72], 'one chunk with every sample');
const offset = stbl('stco').getUint32(8), mdat = found.get('/mdat');
assert.equal(offset, mdat.at + 8, 'the chunk starts at the media data');
assert.equal(mdat.size - 8, sizes.reduce((sum, size) => sum + size, 0));
assert.deepEqual(Array.from(bytes.subarray(offset, offset + 4)), [0, 1, 2, 3], 'the first sample');
assert.deepEqual(Array.from(bytes.subarray(offset + 4, offset + 9)), [1, 2, 3, 4, 5], 'the second sample follows it');
const mdhd = found.get('/moov/trak/mdia/mdhd').view, mvhd = found.get('/moov/mvhd').view, tkhd = found.get('/moov/trak/tkhd').view;
assert.deepEqual([mdhd.getUint32(12), mdhd.getUint32(16)], [24, 72], 'the track runs at the frame rate');
assert.deepEqual([mvhd.getUint32(12), mvhd.getUint32(16)], [1000, 3000]);
assert.deepEqual([tkhd.getUint32(76) >>> 16, tkhd.getUint32(80) >>> 16], [200, 150]);
const stsd = stbl('stsd');
assert.deepEqual([stsd.getUint16(8 + 8 + 24), stsd.getUint16(8 + 8 + 26)], [200, 150], 'the sample entry has the even picture size');
const avcC = 8 + 8 + 78;
assert.equal(String.fromCharCode(...[4, 5, 6, 7].map(index => stsd.getUint8(avcC + index))), 'avcC');
assert.deepEqual(Array.from({ length: description.length }, (_, index) => stsd.getUint8(avcC + 8 + index)), Array.from(description));
assert.deepEqual(encoded.map(frame => frame.timestamp).slice(0, 3), [0, 41667, 83333]);
assert.deepEqual({ ...encoded[0].visibleRect }, { x: 0, y: 0, width: 200, height: 150 });
assert.deepEqual(position(), [0, 0, 25], 'the spin ends where it began');

// A cancelled recording stops at once and gives the camera back; only one runs at a time.
encoded.length = 0;
const controller = new AbortController();
const long = media.record(plugin, { seconds: 60, fps: 60, spin: true }, controller.signal).then(() => 'finished', error => error.name);
for (let wait = 0; wait < 200 && encoded.length < 5; wait++) await new Promise(resolve => setTimeout(resolve, 5));
assert.notDeepEqual(position(), [0, 0, 25], 'the camera is turning');
await assert.rejects(media.record(plugin, { seconds: 1, fps: 24, spin: true }), /already being recorded/);
controller.abort();
assert.equal(await Promise.race([long, new Promise(resolve => setTimeout(() => resolve('still recording'), 1000))]), 'AbortError');
assert.ok(encoded.length < 3600);
assert.deepEqual(position(), [0, 0, 25], 'the camera is back where the recording found it');
assert.equal((await media.record(plugin, { seconds: 1, fps: 24, spin: false })).type, 'video/mp4', 'the next recording starts');
console.log('Movie recording writes a consistent MP4, stops when cancelled and restores the camera.');
