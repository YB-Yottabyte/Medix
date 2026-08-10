"use client";

export const codeHref =
  process.env.NEXT_PUBLIC_CODE_URL || "https://github.com/ZB-ZettaByte/Medix";

export const menuItems: Array<{
  name: string;
  href: string;
  external?: boolean;
}> = [
  { name: "How it works", href: "#features" },
  { name: "Pipeline", href: "#pipeline" },
  { name: "Research", href: "#quest3-research" },
];

/**
 * These name what the system actually does today. Grounded SAM 2, Qdrant,
 * Groq LLaMA, and the AR overlay are no longer part of the pipeline.
 */
export const capabilityPills = [
  "Voice Input",
  "Multimodal Video Grounding",
  "EvidenceBundle",
  "Timestamped Citations",
  "Conversational Follow-ups",
  "Local / Sol LLM Inference",
  "MedVidQA",
];

export const greetingPlaceholders = [
  "Hello, how can I help today?",
  "Hola, ¿cómo puedo ayudarte hoy?",
  "Bonjour, comment puis-je vous aider?",
  "नमस्ते, मैं आपकी कैसे मदद कर सकता हूँ?",
  "你好，我能帮你什么？",
  "Olá, como posso ajudar hoje?",
  "こんにちは、どのようにお手伝いできますか？",
  "Hallo, wie kann ich Ihnen helfen?",
  "Ciao, come posso aiutarti oggi?",
];

export const demoQuestion = "How do I pack a wound that won't stop bleeding?";

export const demoResponse =
  "If direct pressure hasn't stopped the bleeding, pack the wound with gauze and keep pressing.\n\n1. Push gauze deep into the wound, as far as it will go [0:16–0:31]\n2. Keep adding gauze until no more will fit [0:31–0:44]\n3. Press down hard on top with both hands [0:44–0:58]\n\nThe clip doesn't cover how long to hold pressure before help arrives.";

export const alternatingSectionBackgrounds = [
  "bg-white",
  "bg-[#f8fafc]",
] as const;
