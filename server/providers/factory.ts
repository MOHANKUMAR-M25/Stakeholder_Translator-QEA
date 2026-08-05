import type { AgentProvider, AuthMode } from "./types.js";
import { createClaudeProvider } from "./claude.js";


export function createProvider(providerName: "claude" , auth: AuthMode, apiKey?: string): AgentProvider {
  if (providerName === "claude") return createClaudeProvider(auth, apiKey);
  throw new Error(`Unknown provider "${providerName}".`);
}
