import { chatModels, getCapabilities } from "@/lib/ai/models";

export async function GET() {
  const capabilities = getCapabilities();
  return Response.json(
    { capabilities, models: chatModels },
    { headers: { "Cache-Control": "no-store" } }
  );
}
