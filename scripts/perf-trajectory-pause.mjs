// Manual native UI pause acceptance, deliberately outside ready/seek timings.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function readPauseAcknowledgement(path, readyAt) {
  if (statSync(path).size > 2048) throw new Error('Pause acknowledgement exceeds 2 KiB.');
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.paused !== true || typeof value.evidencePath !== 'string'
    || !isAbsolute(value.evidencePath) || !/\.(png|jpe?g|webp)$/i.test(value.evidencePath)
    || statSync(value.evidencePath).mtimeMs <= readyAt) {
    throw new Error('Pause acknowledgement requires paused:true and a fresh absolute screenshot evidencePath.');
  }
  return { paused: true, evidencePath: value.evidencePath, evidenceModifiedAt: statSync(value.evidencePath).mtimeMs };
}

export async function trajectoryPauseRendezvous({ output, name, run, pid, sessionDir, documentId, assertUnlocked }) {
  const readyPath = `${output}.pause-${name}-${run + 1}.ready`;
  const finishPath = `${output}.pause-${name}-${run + 1}.finish`;
  if (existsSync(readyPath) || existsSync(finishPath)) throw new Error('Refusing to overwrite pause acceptance evidence.');
  const readyAt = Date.now();
  writeFileSync(readyPath, JSON.stringify({ pid, sessionDir, documentId, case: name, run: run + 1, readyAt }), { flag: 'wx' });
  const markerModifiedAt = statSync(readyPath).mtimeMs;
  console.error(`Check native playback is paused; save a fresh screenshot and write ${finishPath} with {"paused":true,"evidencePath":"/absolute/screenshot.png"}.`);
  while (!existsSync(finishPath)) {
    if (Date.now() - readyAt >= 5 * 60_000) throw new Error('Native pause acceptance timed out after five minutes.');
    assertUnlocked();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return { ...readPauseAcknowledgement(finishPath, markerModifiedAt), acceptedAt: new Date().toISOString(), markerModifiedAt, readyPath, finishPath };
}
