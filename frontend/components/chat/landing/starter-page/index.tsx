"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { generateUUID } from "@/lib/utils";
import { BrandIntro } from "./brand-intro";
import { CapabilityShowcase } from "./capability-showcase";
import { greetingPlaceholders } from "./data";
import { StarterPageFooter } from "./footer";
import { HeroHeader } from "./hero-header";
import { HeroSection } from "./hero-section";
import { PipelineSection } from "./pipeline-section";
import { ResearchSection } from "./research-section";

export function StarterPage() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const [introComplete, setIntroComplete] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");

  const startChat = (value?: string) => {
    const nextPrompt = (value ?? prompt).trim();
    const chatId = generateUUID();

    if (!nextPrompt) {
      router.push(`/chat/${chatId}`);
      return;
    }

    router.push(`/chat/${chatId}?query=${encodeURIComponent(nextPrompt)}`);
  };

  useEffect(() => {
    if (prefersReducedMotion) {
      setTypedPlaceholder("Ask Medix a medical question");
      return;
    }

    const currentGreeting = greetingPlaceholders[placeholderIndex];
    let timeoutId: number;

    if (typedPlaceholder.length < currentGreeting.length) {
      timeoutId = window.setTimeout(() => {
        setTypedPlaceholder(
          currentGreeting.slice(0, typedPlaceholder.length + 1)
        );
      }, 36);
    } else {
      timeoutId = window.setTimeout(() => {
        setTypedPlaceholder("");
        setPlaceholderIndex(
          (current) => (current + 1) % greetingPlaceholders.length
        );
      }, 1350);
    }

    return () => window.clearTimeout(timeoutId);
  }, [placeholderIndex, prefersReducedMotion, typedPlaceholder]);

  return (
    <>
      <BrandIntro onComplete={() => setIntroComplete(true)} />
      {introComplete && <HeroHeader />}
      <motion.main
        animate={{ opacity: introComplete ? 1 : 0, y: introComplete ? 0 : 12 }}
        className="relative min-h-dvh overflow-hidden bg-white text-foreground"
        initial={{ opacity: 0, y: 12 }}
        transition={{
          delay: introComplete ? 0.05 : 0,
          duration: 0.62,
          ease: [0.22, 1, 0.36, 1],
        }}
      >
        <HeroSection
          prompt={prompt}
          setPrompt={setPrompt}
          startChat={startChat}
          typedPlaceholder={typedPlaceholder}
        />
        <CapabilityShowcase startChat={startChat} />
        <PipelineSection prefersReducedMotion={Boolean(prefersReducedMotion)} />
        <ResearchSection startChat={startChat} />
        <StarterPageFooter />
      </motion.main>
    </>
  );
}
