"use client";

import {
  Show,
  SignInButton,
  SignUpButton,
  UserButton,
} from "@clerk/nextjs";
import { PanelLeftIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useActiveChat } from "@/hooks/use-active-chat";
import { isLocalAuthBypassed } from "@/lib/constants";
import { useMedixAuth } from "./auth-state-provider";
import { ModelSelectorCompact } from "./multimodal-input";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ChatHeader() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const { currentModelId, setCurrentModelId } = useActiveChat();
  const { isAuthenticated, isLoaded } = useMedixAuth();
  const sidebarIsHidden = state === "collapsed" || isMobile;
  const showAuthActions =
    isLocalAuthBypassed || (isLoaded && !isAuthenticated);

  return (
    <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-1.5 bg-white px-2 font-sans dark:bg-background sm:px-3.5">
      {sidebarIsHidden && (
        <Button
          aria-label="Open sidebar"
          className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={toggleSidebar}
          size="icon-sm"
          variant="ghost"
        >
          <PanelLeftIcon className="size-4" strokeWidth={1.8} />
        </Button>
      )}

      <ModelSelectorCompact
        onModelChange={setCurrentModelId}
        selectedModelId={currentModelId}
      />

      {clerkEnabled ? (
        <ClerkHeaderAuthActions />
      ) : (
        showAuthActions && <LegacyHeaderAuthActions />
      )}
    </header>
  );
}

function ClerkHeaderAuthActions() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <Show when="signed-out">
        <SignInButton>
          <button
            className="group/login relative flex h-9 items-center overflow-hidden rounded-full border border-slate-300 bg-white px-4 text-[12.5px] font-medium text-slate-950 transition-colors duration-500 hover:text-white"
            type="button"
          >
            <span className="absolute inset-0 bg-slate-950 [clip-path:polygon(0_100%,0_100%,0_100%)] transition-[clip-path] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/login:[clip-path:polygon(0_100%,0_-100%,200%_100%)]" />
            <span className="relative z-10">Log in</span>
          </button>
        </SignInButton>
        <SignUpButton>
          <button
            className="h-9 rounded-md border-0 bg-transparent px-4 text-[12.5px] font-normal text-slate-950 shadow-none transition-colors hover:bg-slate-100"
            type="button"
          >
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton
          appearance={{
            elements: {
              avatarBox: "size-8",
            },
          }}
        />
      </Show>
    </div>
  );
}

function LegacyHeaderAuthActions() {
  return (
    <div className="ml-auto flex items-center gap-2">
      <Link
        className="group/login relative flex h-9 items-center overflow-hidden rounded-full border border-slate-300 bg-white px-4 text-[12.5px] font-medium text-slate-950 transition-colors duration-500 hover:text-white"
        href="/login"
      >
        <span className="absolute inset-0 bg-slate-950 [clip-path:polygon(0_100%,0_100%,0_100%)] transition-[clip-path] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/login:[clip-path:polygon(0_100%,0_-100%,200%_100%)]" />
        <span className="relative z-10">Log in</span>
      </Link>
      <Button
        asChild
        className="h-9 rounded-md border-0 bg-transparent px-4 text-[12.5px] font-normal text-slate-950 shadow-none hover:bg-slate-100"
        variant="ghost"
      >
        <Link href="/register">Sign up</Link>
      </Button>
    </div>
  );
}
