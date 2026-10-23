import type { Metadata } from "next";
import { HeroHeader } from "@/components/chat/landing/starter-page/hero-header";
import { DocsExplorer } from "@/components/docs/docs-explorer";

export const metadata: Metadata = {
  description:
    "Technical documentation for Medix retrieval, multimodal grounding, evidence generation, and verified research results.",
  title: "Medix Documentation | Architecture & Research",
};
export default function DocsPage() {
  return (
    <main className="min-h-dvh bg-white text-slate-900">
      <HeroHeader />
      <DocsExplorer />
    </main>
  );
}
