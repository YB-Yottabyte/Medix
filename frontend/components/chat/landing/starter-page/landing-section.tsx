"use client";

import { cn } from "@/lib/utils";
import { alternatingSectionBackgrounds } from "./data";

export function LandingSection({
  index,
  id,
  className,
  children,
}: {
  index: number;
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        alternatingSectionBackgrounds[index % alternatingSectionBackgrounds.length],
        className
      )}
      id={id}
    >
      {children}
    </section>
  );
}
