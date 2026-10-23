"use client";

import { Show, SignInButton, SignUpButton, UserButton } from "@clerk/nextjs";
import { PanelLeftIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { chatModels, DEFAULT_CHAT_MODEL } from "@/lib/ai/models";
import { isLocalAuthBypassed } from "@/lib/constants";
import { useMedixAuth } from "./auth-state-provider";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function ChatHeader() {
  const { state, toggleSidebar, isMobile } = useSidebar();
  const { isAuthenticated, isLoaded } = useMedixAuth();
  const sidebarIsHidden = state === "collapsed" || isMobile;
  const showAuthActions = isLocalAuthBypassed || (isLoaded && !isAuthenticated);

  return (
    <header className="sticky top-0 z-30 flex h-13 shrink-0 items-center gap-1.5 bg-background px-2 font-sans sm:px-3.5">
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

      <span
        className="px-2 font-medium text-foreground text-sm"
        data-testid="active-model"
      >
        {chatModels.find((model) => model.id === DEFAULT_CHAT_MODEL)?.name ??
          "Medix"}
      </span>

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
            className="medix-blue-sweep relative flex h-9 items-center rounded-xl border border-primary bg-primary px-4 font-medium text-[12.5px] text-primary-foreground transition-colors hover:bg-primary/90"
            type="button"
          >
            <span className="relative z-10">Log in</span>
          </button>
        </SignInButton>
        <SignUpButton>
          <button
            className="h-9 rounded-md border-0 bg-transparent px-4 font-normal text-[12.5px] text-slate-950 shadow-none transition-colors hover:bg-slate-100"
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
        className="medix-blue-sweep relative flex h-9 items-center rounded-xl border border-primary bg-primary px-4 font-medium text-[12.5px] text-primary-foreground transition-colors hover:bg-primary/90"
        href="/login"
      >
        <span className="relative z-10">Log in</span>
      </Link>
      <Button
        asChild
        className="h-9 rounded-md border-0 bg-transparent px-4 font-normal text-[12.5px] text-slate-950 shadow-none hover:bg-slate-100"
        variant="ghost"
      >
        <Link href="/register">Sign up</Link>
      </Button>
    </div>
  );
}
