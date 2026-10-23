import { cn } from "@/lib/utils";

export function MedixBrand({ className }: { className?: string }) {
  return (
    <span
      aria-label="Medix"
      className={cn(
        "inline-flex items-center font-semibold text-foreground leading-none tracking-[-0.025em]",
        className
      )}
      role="img"
    >
      <span aria-hidden="true">M</span>
      <span
        aria-hidden="true"
        className="mx-[0.14em] inline-block h-[0.92em] w-[0.28em] shrink-0 bg-primary [clip-path:polygon(0_0,34%_0,100%_100%,66%_100%)]"
      />
      <span aria-hidden="true">EDIX</span>
    </span>
  );
}
