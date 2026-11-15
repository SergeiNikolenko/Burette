import { atomsFromZmatrixDocument, formatZmatrixDocument, parseZmatrixDocument } from './zmatrix-document.mjs';
import { formatXyz, parseXyzAtoms, placeInReferenceFrame } from './internal-coordinates.mjs';
import { zmatrixDocumentFromAtoms } from './zmatrix-export.mjs';

const PREFIX = 'BURETTE_INTERNAL_COORDINATES_V1=';
const NAMESPACE = 'BURETTE_INTERNAL_COORDINATES_V';
const MAX_BYTES = 1024 * 1024;
const utf8 = new TextEncoder();
const fromGeometry = atoms => atoms.map(({ element, position: [x, y, z] }) => ({ element, x, y, z }));
const toGeometry = atoms => atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
function invalid(message, code = 'INVALID_COORDINATES') { throw Object.assign(new Error(message), { code }); }
function bounded(text) {
  if (typeof text !== 'string') invalid('Coordinate interchange requires text.');
  if (text.length > MAX_BYTES || utf8.encode(text).length > MAX_BYTES) invalid('Coordinate interchange exceeds 1 MiB.', 'COORDINATE_LIMIT');
  return text;
}
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some(key => !Object.hasOwn(value, key))) invalid('Invalid internal-coordinate marker shape.');
}

/** The wire carries the existing absolute-atoms/definition pair, nothing else. */
function checkedPair(value) {
  record(value, ['atoms', 'internalCoordinates']);
  if (!Array.isArray(value.atoms) || value.atoms.length < 1 || value.atoms.length > 512) invalid('Coordinate interchange requires 1–512 real atoms.', 'COORDINATE_LIMIT');
  for (const atom of value.atoms) {
    record(atom, ['element', 'x', 'y', 'z']);
    if (typeof atom.element !== 'string' || !/^[A-Z][a-z]?$/u.test(atom.element) || ![atom.x, atom.y, atom.z].every(Number.isFinite)) invalid('Invalid marker atom.');
  }
  const definition = value.internalCoordinates;
  record(definition, ['rows', 'variables']);
  if (!Array.isArray(definition.rows) || definition.rows.length < 1 || definition.rows.length > 512
    || !Array.isArray(definition.variables) || definition.variables.length > 1536) invalid('Internal-coordinate definition exceeds its row or variable limit.', 'COORDINATE_LIMIT');
  for (const row of definition.rows) {
    record(row, ['element', 'refs', 'values']);
    if (typeof row.element !== 'string' || !Array.isArray(row.refs) || !Array.isArray(row.values)
      || row.refs.length > 3 || row.values.length > 3 || row.values.some(v => typeof v !== 'string' && typeof v !== 'number')) invalid('Invalid marker definition row.');
  }
  for (const variable of definition.variables) {
    record(variable, ['name', 'value']);
    if (typeof variable.name !== 'string' || !Number.isFinite(variable.value)) invalid('Invalid marker variable.');
  }
  // Existing parsers own element, reference, coordinate, separation and variable semantics.
  const reference = parseXyzAtoms(formatXyz(toGeometry(value.atoms), ''));
  const canonical = parseZmatrixDocument(formatZmatrixDocument(definition));
  const rebuilt = atomsFromZmatrixDocument(canonical);
  if (rebuilt.length !== reference.length || rebuilt.some((atom, i) => atom.element !== reference[i].element)) invalid('Definition atoms do not match the absolute geometry.');
  const aligned = placeInReferenceFrame(rebuilt, reference);
  if (aligned.some((atom, i) => atom.position.some((v, axis) => Math.abs(v - reference[i].position[axis]) > 1e-5))) invalid('Definition shape does not match the absolute geometry.');
  // Alignment only checks consistency. Never replace the authoritative coordinates with its result.
  return { atoms: fromGeometry(reference), internalCoordinates: canonical };
}
function encode(value) {
  const bytes = utf8.encode(JSON.stringify(value));
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function decode(payload) {
  if (!/^[A-Za-z0-9_-]+$/u.test(payload) || payload.length % 4 === 1) invalid('Malformed internal-coordinate marker encoding.');
  let value;
  try {
    const binary = atob(payload.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - payload.length % 4) % 4));
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = JSON.parse(text);
    // Canonical base64url excludes alternate trailing bits; JSON whitespace/key order may vary.
    if (btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '') !== payload) invalid('Noncanonical marker encoding.');
  } catch { invalid('Malformed internal-coordinate marker encoding.'); }
  return checkedPair(value);
}
function sameAtoms(a, b) {
  return a.length === b.length && a.every((atom, i) => atom.element === b[i].element
    && atom.x === b[i].x && atom.y === b[i].y && atom.z === b[i].z);
}
function formatKind(format) { if (format !== 'xyz' && format !== 'zmat') invalid('Coordinate format must be xyz or zmat.'); }

function xyzComment(comment, occurrences) {
  if (occurrences > 1) invalid('Only one internal-coordinate marker is allowed.');
  if (!occurrences) return { comment, saved: null };
  const match = /(?:^|[ \t])BURETTE_INTERNAL_COORDINATES_V1=([A-Za-z0-9_-]+)$/u.exec(comment);
  if (!match) invalid('Unsupported or misplaced internal-coordinate marker.');
  return { comment: comment.slice(0, match.index), saved: decode(match[1]) };
}
function markedComment(checked, comment, appendComment = '') {
  bounded(comment);
  if (/[\r\n]/u.test(comment) || comment.includes(NAMESPACE)) invalid('Use an ordinary single-line coordinate comment.');
  comment = comment.replace(/ zdef-[0-9a-f]{8}$/u, '');
  if (appendComment) {
    bounded(appendComment);
    if (/[\r\n]/u.test(appendComment) || appendComment.includes(NAMESPACE)) invalid('Use an ordinary single-line coordinate comment.');
    comment += `${comment ? ' ' : ''}${appendComment}`;
  }
  return `${comment}${comment ? ' ' : ''}${PREFIX}${encode(checked)}`;
}

/** Replace only the XYZ comment; managed atom rows must already match the new pair. */
export function writeCoordinateInterchangeXyzSource(text, pair, appendComment = '') {
  bounded(text);
  const header = /^([^\r\n]*(?:\r\n|\r|\n))([^\r\n]*)(\r\n|\r|\n)/u.exec(text);
  if (!header) invalid('Expected an XYZ count and comment line.');
  // An existing marker must be valid, but may describe the pre-edit geometry.
  const { comment } = xyzComment(header[2], text.split(NAMESPACE).length - 1);
  const checked = checkedPair({ atoms: pair.atoms, internalCoordinates: pair.internalCoordinates });
  if (!sameAtoms(fromGeometry(parseXyzAtoms(text)), checked.atoms)) invalid('XYZ atom rows conflict with the new internal-coordinate pair.');
  return bounded(`${header[1]}${markedComment(checked, comment, appendComment)}${header[3]}${text.slice(header[0].length)}`);
}

/** Read one plain XYZ frame or headerless ZMAT. A recognized bad marker never falls back. */
export function readCoordinateInterchange(text, format) {
  formatKind(format);
  const lines = bounded(text).replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const occurrences = lines.join('\n').split(NAMESPACE).length - 1;
  if (occurrences > 1) invalid('Only one internal-coordinate marker is allowed.');
  let saved = null, comment = '';
  if (format === 'xyz') {
    ({ comment, saved } = xyzComment(lines[1] ?? '', occurrences));
    const atoms = fromGeometry(parseXyzAtoms(lines.join('\n')));
    if (saved && !sameAtoms(atoms, saved.atoms)) invalid('XYZ atom rows conflict with the internal-coordinate marker.');
    const pair = saved ?? checkedPair({ atoms, internalCoordinates: zmatrixDocumentFromAtoms(toGeometry(atoms)) });
    return { ...pair, atoms, comment };
  }
  if (occurrences) {
    const line = lines.find(line => line.includes(NAMESPACE));
    const match = /^\s*#\s*BURETTE_INTERNAL_COORDINATES_V1=([A-Za-z0-9_-]+)$/u.exec(line);
    if (!match) invalid('Unsupported or misplaced internal-coordinate marker.');
    saved = decode(match[1]);
  }
  const human = lines.find(line => /^\s*#/u.test(line) && !line.includes(NAMESPACE));
  if (human !== undefined) comment = human.replace(/^\s*# ?/u, '');
  const internalCoordinates = parseZmatrixDocument(lines.join('\n'));
  if (saved && formatZmatrixDocument(internalCoordinates) !== formatZmatrixDocument(saved.internalCoordinates)) invalid('Z-matrix definition conflicts with the internal-coordinate marker.');
  const pair = saved ?? checkedPair({ atoms: fromGeometry(atomsFromZmatrixDocument(internalCoordinates)), internalCoordinates });
  return { ...pair, internalCoordinates, comment };
}

/** Serialize standard rows and one marker; all validation precedes any caller's file mutation. */
export function writeCoordinateInterchange(pair, format, comment = '') {
  formatKind(format);
  if (!pair || typeof pair !== 'object') invalid('Coordinate interchange requires atoms and a definition.');
  const checked = checkedPair({ atoms: pair.atoms, internalCoordinates: pair.internalCoordinates });
  const fullComment = markedComment(checked, comment);
  const markerAt = fullComment.indexOf(PREFIX);
  const human = markerAt ? fullComment.slice(0, markerAt - 1) : '';
  return bounded(format === 'xyz'
    ? formatXyz(toGeometry(checked.atoms), fullComment)
    : `${human ? `# ${human}\n` : ''}# ${fullComment.slice(markerAt)}\n${formatZmatrixDocument(checked.internalCoordinates)}`);
}
