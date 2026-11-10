import * as dotenv from "dotenv";

dotenv.config();

import { SYSTEM_PROMPT } from "../assistants";
import { TOOL_DEFINITIONS } from "../tools";
import { VapiClient } from "@vapi-ai/server-sdk";

const apiKey = process.env.VAPI_API_KEY;
const assistantId = process.env.VAPI_ASSISTANT_ID;

if (!apiKey || !assistantId) {
  console.error("❌ Missing VAPI_API_KEY or VAPI_ASSISTANT_ID in .env");
  process.exit(1);
}

const vapi = new VapiClient({ token: apiKey });

async function updateToolsAndAssistant() {
  console.log("🔄 Fetching existing Vapi tools via SDK...");
  const existingTools = (await vapi.tools.list()) as any[];
  console.log(`Found ${existingTools.length} existing tools on account.`);

  const configuredToolIds: string[] = [];

  for (const def of TOOL_DEFINITIONS) {
    const existing = existingTools.find(
      (t) => t.name === def.name || t.function?.name === def.name,
    );

    if (existing) {
      console.log(`Updating tool: ${def.name} (${existing.id})...`);
      const updated = await vapi.tools.update({
        id: existing.id,
        body: def,
      });
      configuredToolIds.push((updated as any).id || existing.id);
    } else {
      console.log(`Creating tool: ${def.name}...`);
      const created = await vapi.tools.create(def);
      configuredToolIds.push((created as any).id);
    }
  }

  console.log("\nConfigured 5 Modular Tool IDs:", configuredToolIds);

  const targetAssistantId = assistantId!;

  // Fetch current assistant configuration
  console.log(`\n🔄 Updating Assistant ${targetAssistantId} via SDK...`);
  const currentAssistant = (await vapi.assistants.get({
    id: targetAssistantId,
  })) as any;

  await vapi.assistants.update({
    id: targetAssistantId,
    model: {
      provider: currentAssistant.model?.provider || "openai",
      model: currentAssistant.model?.model || "gpt-4o",
      toolIds: configuredToolIds,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
      ],
    },
  });

  console.log("✅ Assistant successfully updated with TypeScript SDK!");
}

updateToolsAndAssistant().catch((err) => {
  console.error("❌ Failed to update tools and assistant:", err);
  process.exit(1);
});
