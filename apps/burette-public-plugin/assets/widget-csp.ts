import { config } from "zod/v4/core";

// Initialize before MCP schemas: a caught eval probe still violates widget CSP.
// Keep validation enabled, using Zod's interpreted parser.
config({ jitless: true });
