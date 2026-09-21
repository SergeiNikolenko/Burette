const devInstanceSuffix = import.meta.env.VITE_BURETTE_DEV_INSTANCE ?? "8a18";
const agentShell = import.meta.env.VITE_BURETTE_AGENT_SHELL === "1";

export const appInstanceLabel = import.meta.env.DEV
  ? agentShell ? "Burette Agent" : `Burette Dev ${devInstanceSuffix}`
  : "Burette";
