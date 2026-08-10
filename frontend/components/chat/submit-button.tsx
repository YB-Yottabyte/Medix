"use client";

import { useFormStatus } from "react-dom";

import { LoaderIcon } from "@/components/chat/icons";

import { Button } from "../ui/button";

export function SubmitButton({
  children,
  isSuccessful,
  pendingText,
}: {
  children: React.ReactNode;
  isSuccessful: boolean;
  pendingText?: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending || isSuccessful}
      className="relative mt-1 h-11 rounded-full bg-slate-950 text-[13px] font-medium text-white shadow-none transition-[background-color,transform] duration-200 hover:bg-slate-800 active:scale-[0.99]"
      disabled={pending || isSuccessful}
      type={pending ? "button" : "submit"}
    >
      {pending && pendingText ? pendingText : children}

      {(pending || isSuccessful) && (
        <span className="absolute right-4 animate-spin">
          <LoaderIcon />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {pending || isSuccessful ? "Loading" : "Submit form"}
      </output>
    </Button>
  );
}
