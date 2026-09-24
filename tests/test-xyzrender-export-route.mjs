import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { rm, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { registerXyzrenderExportRoute } from '../apps/desktop/vite/browser-dev/xyzrender-export.ts';
import { encodeAnimation } from '../apps/desktop/src/lib/xyzrender-animation.ts';
let handler;
registerXyzrenderExportRoute({ middlewares: { use: (_path, callback) => { handler = callback; } } });
const server = createServer((req,res) => handler(req,res));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let artifact;
try {
 const bad = await fetch(base, { method:'POST',body:JSON.stringify({gifBase64:'AAAA'}) });
 assert.equal(bad.status,400);
 const bytes = await encodeAnimation({width:1,height:1,frames:[new Uint8ClampedArray([255,0,0,255])]},0,0,10,()=>{});
 const post = await fetch(base,{method:'POST',body:JSON.stringify({name:'../sample.gif',gifBase64:Buffer.from(bytes).toString('base64')})});
 assert.equal(post.status,200); artifact=await post.json();
 assert.equal(artifact.name,'.._sample.gif');
 const download = await fetch(`${base}/${artifact.downloadUrl.split('/').pop()}`);
 assert.equal(download.status,200);
 assert.equal(download.headers.get('content-type'),'image/gif');
 assert.match(download.headers.get('content-disposition'),/attachment/);
 assert.deepEqual(Buffer.from(await download.arrayBuffer()),Buffer.from(bytes));
 assert.deepEqual(await readFile(artifact.path),Buffer.from(bytes));
 assert.equal((await fetch(`${base}/missing`)).status,404);
 console.log('xyzrender export saved file and HTTP attachment passed');
} finally {
 server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
 if(artifact) await rm(dirname(artifact.path),{recursive:true});
}
