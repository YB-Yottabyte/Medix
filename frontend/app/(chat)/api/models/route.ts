import { chatModels, getCapabilities, SOL_CHAT_MODEL } from "@/lib/ai/models";
import { isSolAvailable } from "@/lib/ai/sol";

export async function GET() {
  const capabilities = await getCapabilities();

  // Sol depends on a live SSH tunnel and GPU job, so its reachability is
  // probed per request and never cached. Everything else is static.
  const solOnline = await isSolAvailable();
  const models = chatModels.map((model) =>
    model.id === SOL_CHAT_MODEL ? { ...model, offline: !solOnline } : model
  );

  return Response.json(
    { capabilities, models },
    { headers: { "Cache-Control": "no-store" } }
  );
}
