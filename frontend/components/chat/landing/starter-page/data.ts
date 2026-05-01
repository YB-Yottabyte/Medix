"use client";

export const codeHref =
  process.env.NEXT_PUBLIC_CODE_URL || "https://github.com/ZB-ZettaByte/Medix";

export const menuItems: Array<{
  name: string;
  href: string;
  external?: boolean;
}> = [
  { name: "How It Works", href: "#features" },
  { name: "Pipeline", href: "#pipeline" },
  { name: "Quest 3 Research", href: "#quest3-research" },
];

export const capabilityPills = [
  "Voice Input",
  "Grounded SAM 2",
  "Qdrant Search",
  "Groq LLaMA",
  "AR Overlay",
  "MedVidQA Dataset",
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

export const demoQuestion =
  "Hey, I cut my hand while cooking. Does this look like something I can treat at home?";

export const demoResponse =
  "From what I can see, this looks like a minor cut that is usually manageable at home if the bleeding slows down and the wound is not very deep. Press a clean cloth or sterile gauze on it for a few minutes, rinse it gently under cool running water, and cover it with a clean bandage. If the bleeding keeps going, the cut is deep, or the skin edges stay open, you should get medical care.";

export const alternatingSectionBackgrounds = ["bg-white", "bg-[#f8fafc]"] as const;
