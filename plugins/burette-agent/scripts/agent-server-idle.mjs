// Only CLI-owned servers expire; manual Vite and native sessions stay untouched.
export function installAgentServerIdleTimeout(server) {
  const owner = Number(process.env.BURETTE_AGENT_SERVER_PID);
  const timeoutMs = Number(process.env.BURETTE_AGENT_SERVER_IDLE_TIMEOUT_MS);
  if (!server || !Number.isInteger(owner) || owner <= 1 || !(timeoutMs > 0)) return;
  let lastActivity = Date.now();
  let active = 0;
  const hold = (target, event) => {
    active += 1;
    lastActivity = Date.now();
    target.once(event, () => {
      active -= 1;
      lastActivity = Date.now();
    });
  };
  // SSE/long responses and Vite's HMR sockets keep an open workspace alive.
  const request = (req, res) => {
    if (req.url?.split('?')[0] !== '/healthz') hold(res, 'close');
  };
  const upgrade = (_req, socket) => hold(socket, 'close');
  server.on('request', request);
  server.on('upgrade', upgrade);
  const timer = setInterval(() => {
    if (active || Date.now() - lastActivity < timeoutMs) return;
    clearInterval(timer);
    console.log('Stopping idle agent browser server.');
    process.kill(owner, 'SIGTERM');
  }, Math.min(timeoutMs, 1000));
  timer.unref();
  server.once('close', () => {
    clearInterval(timer);
    server.off('request', request);
    server.off('upgrade', upgrade);
  });
}
