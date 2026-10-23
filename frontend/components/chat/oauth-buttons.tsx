"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs";
import { GithubIcon } from "lucide-react";
import { getProviders, signIn as nextAuthSignIn } from "next-auth/react";
import { useState } from "react";
import { LogoGoogle } from "@/components/chat/icons";
import { clerkErrorMessage } from "@/lib/auth/clerk-errors";
import { generateUUID } from "@/lib/utils";
import { toast } from "./toast";

// Apple glyph: Bootstrap Icons, MIT; see licenses/bootstrap-icons.txt.
const providers = [
  {
    icon: (
      <svg
        aria-hidden="true"
        className="size-[18px]"
        fill="currentColor"
        viewBox="0 0 16 16"
      >
        <path d="M11.182.008C11.148-.03 9.923.023 8.857 1.18c-1.066 1.156-.902 2.482-.878 2.516s1.52.087 2.475-1.258.762-2.391.728-2.43m3.314 11.733c-.048-.096-2.325-1.234-2.113-3.422s1.675-2.789 1.698-2.854-.597-.79-1.254-1.157a3.7 3.7 0 0 0-1.563-.434c-.108-.003-.483-.095-1.254.116-.508.139-1.653.589-1.968.607-.316.018-1.256-.522-2.267-.665-.647-.125-1.333.131-1.824.328-.49.196-1.422.754-2.074 2.237-.652 1.482-.311 3.83-.067 4.56s.625 1.924 1.273 2.796c.576.984 1.34 1.667 1.659 1.899s1.219.386 1.843.067c.502-.308 1.408-.485 1.766-.472.357.013 1.061.154 1.782.539.571.197 1.111.115 1.652-.105.541-.221 1.324-1.059 2.238-2.758q.52-1.185.473-1.282" />
      </svg>
    ),
    id: "apple",
    label: "Continue with Apple",
  },
  {
    icon: <GithubIcon className="size-[18px] fill-current" strokeWidth={1.6} />,
    id: "github",
    label: "Continue with GitHub",
  },
  {
    icon: <LogoGoogle size={18} />,
    id: "google",
    label: "Continue with Google",
  },
] as const;

type OAuthMode = "legacy" | "sign-in" | "sign-up";

export function OAuthButtons({ mode }: { mode: OAuthMode }) {
  if (mode === "legacy") {
    return <LegacyOAuthButtons />;
  }
  return <ClerkOAuthButtons mode={mode} />;
}

function ClerkOAuthButtons({ mode }: { mode: Exclude<OAuthMode, "legacy"> }) {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const continueWith = async (providerId: (typeof providers)[number]["id"]) => {
    setPendingProvider(providerId);
    const params = {
      redirectCallbackUrl: "/sso-callback",
      redirectUrl: `/chat/${generateUUID()}`,
      strategy: `oauth_${providerId}` as const,
    };
    const { error } =
      mode === "sign-up" ? await signUp.sso(params) : await signIn.sso(params);

    if (error) {
      toast({ description: clerkErrorMessage(error), type: "error" });
      setPendingProvider(null);
    }
  };

  return (
    <OAuthButtonList
      continueWith={continueWith}
      pendingProvider={pendingProvider}
    />
  );
}

function LegacyOAuthButtons() {
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  const continueWith = async (providerId: (typeof providers)[number]["id"]) => {
    setPendingProvider(providerId);

    try {
      const configuredProviders = await getProviders();
      if (!configuredProviders?.[providerId]) {
        toast({
          description: `${providerId[0]?.toUpperCase()}${providerId.slice(1)} sign-in has not been configured yet.`,
          type: "error",
        });
        return;
      }

      await nextAuthSignIn(providerId, {
        redirectTo: `/chat/${generateUUID()}`,
      });
    } finally {
      setPendingProvider(null);
    }
  };

  return (
    <OAuthButtonList
      continueWith={continueWith}
      pendingProvider={pendingProvider}
    />
  );
}

function OAuthButtonList({
  continueWith,
  pendingProvider,
}: {
  continueWith: (providerId: (typeof providers)[number]["id"]) => void;
  pendingProvider: string | null;
}) {
  return (
    <div className="mt-1 grid gap-2.5">
      <div className="flex items-center gap-3 py-1">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="font-medium text-[10.5px] text-slate-400 uppercase tracking-[0.08em]">
          Or
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {providers.map((provider) => (
        <button
          className="relative flex h-11 w-full items-center justify-center rounded-xl border border-border bg-card px-4 font-normal text-[13px] text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition-[background-color,border-color,transform] duration-200 hover:border-primary/40 hover:bg-primary/5 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
          disabled={pendingProvider !== null}
          key={provider.id}
          onClick={() => continueWith(provider.id)}
          type="button"
        >
          <span className="absolute left-4 flex items-center justify-center">
            {provider.icon}
          </span>
          <span>{provider.label}</span>
        </button>
      ))}
    </div>
  );
}
