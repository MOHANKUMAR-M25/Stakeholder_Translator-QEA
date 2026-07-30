import { createClaudeProvider } from "./claude.js";
export function createProvider(providerName, auth, apiKey) {
    if (providerName === "claude")
        return createClaudeProvider(auth, apiKey);
    throw new Error(`Unknown provider "${providerName}".`);
}
