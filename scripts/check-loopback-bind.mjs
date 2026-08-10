#!/usr/bin/env bun
import net from 'node:net';
import { pathToFileURL } from 'node:url';

export function loopbackBindDiagnostic(error) {
  const code = error && typeof error === 'object' ? error.code : null;
  if (code === 'EACCES' || code === 'EPERM') {
    return `Burette ci:fast cannot bind an ephemeral 127.0.0.1 port (${code}). The current sandbox denies loopback listeners; rerun the gate with localhost binding permission.`;
  }
  return `Burette ci:fast loopback preflight failed${code ? ` (${code})` : ''}. Verify that this runtime can bind an ephemeral 127.0.0.1 port.`;
}

export async function checkLoopbackBind() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      server.close(error => error ? reject(error) : resolve());
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkLoopbackBind();
  } catch (error) {
    console.error(loopbackBindDiagnostic(error));
    process.exitCode = 1;
  }
}
