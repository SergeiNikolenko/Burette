import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { readCoordinateInterchange, writeCoordinateInterchange } from './coordinate-interchange.mjs';

const MAX_BYTES = 1024 * 1024;

function invalid(message, code = 'INVALID_COORDINATES') {
  throw Object.assign(new Error(message), { code });
}

export async function convertMolecularCoordinates({ file, format, output, overwrite = false }) {
  const inputFormat = extname(file || '').slice(1).toLowerCase();
  if (!file || !output || !['xyz', 'zmat'].includes(format) || !['xyz', 'zmat'].includes(inputFormat) || inputFormat === format) {
    invalid('convert requires --file (.xyz or .zmat), --format (the other format), and --output.', 'INVALID_ARGS');
  }
  const inputPath = resolve(file), outputPath = resolve(output);
  if (inputPath === outputPath) invalid('Input and output must be different files.', 'SAME_INPUT_OUTPUT');
  const input = await open(inputPath, constants.O_RDONLY | constants.O_NONBLOCK);
  let source, document;
  try {
    source = await input.stat();
    if (!source.isFile()) invalid('Input must be a regular file.');
    if (source.size > MAX_BYTES) invalid('Input exceeds 1 MiB.', 'COORDINATE_LIMIT');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0, bytesRead;
    do {
      ({ bytesRead } = await input.read(buffer, length, buffer.length - length, null));
      length += bytesRead;
    } while (bytesRead && length < buffer.length);
    if (length > MAX_BYTES) invalid('Input exceeds 1 MiB.', 'COORDINATE_LIMIT');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { invalid('Input must be valid UTF-8.'); }
    document = readCoordinateInterchange(text, inputFormat);
  } finally { await input.close(); }
  // The codec admits the complete output before an existing destination can be touched.
  const content = writeCoordinateInterchange(document, format, document.comment);
  let target;
  try {
    target = await open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | (overwrite ? 0 : constants.O_EXCL), 0o600);
    const destination = await target.stat();
    if (!destination.isFile()) invalid('Output must be a regular file.');
    if (source.dev === destination.dev && source.ino === destination.ino) invalid('Input and output must be different files.', 'SAME_INPUT_OUTPUT');
    await target.truncate(0);
    await target.writeFile(content);
  } catch (error) {
    if (error.code === 'EEXIST') invalid('Output exists; pass --overwrite to replace it.', 'OUTPUT_EXISTS');
    throw error;
  } finally { await target?.close(); }
  return { inputPath, outputPath, inputFormat, format, atomCount: document.atoms.length, byteCount: Buffer.byteLength(content) };
}
