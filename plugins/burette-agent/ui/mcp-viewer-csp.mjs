import { config } from 'zod/v4/core';

// Run before the MCP SDK constructs schemas. Even a caught capability probe
// emits a CSP violation in the host; use Zod's interpreted validator instead.
config({ jitless: true });
