"use client";

import { useSignIn, useSignUp } from "@clerk/nextjs";
import { AppleIcon, GithubIcon } from "lucide-react";
import { getProviders, signIn as nextAuthSignIn } from "next-auth/react";
import { useState } from "react";
import { LogoGoogle } from "@/components/chat/icons";
import { clerkErrorMessage } from "@/lib/auth/clerk-errors";
import { generateUUID } from "@/lib/utils";
import { toast } from "./toast";

const providers = [
  {
    id: "apple",
    label: "Continue with Apple",
    icon: <AppleIcon className="size-[18px] fill-current" strokeWidth={1.6} />,
  },
  {
    id: "github",
    label: "Continue with GitHub",
    icon: <GithubIcon className="size-[18px] fill-current" strokeWidth={1.6} />,
  },
  {
    id: "google",
    label: "Continue with Google",
    icon: <LogoGoogle size={18} />,
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
      strategy: `oauth_${providerId}` as const,
      redirectUrl: `/chat/${generateUUID()}`,
      redirectCallbackUrl: "/sso-callback",
    };
    const { error } =
      mode === "sign-up" ? await signUp.sso(params) : await signIn.sso(params);

    if (error) {
      toast({ type: "error", description: clerkErrorMessage(error) });
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
          type: "error",
          description: `${providerId[0]?.toUpperCase()}${providerId.slice(1)} sign-in has not been configured yet.`,
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
        <span className="text-[10.5px] font-medium tracking-[0.08em] text-slate-400 uppercase">
          Or
        </span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>

      {providers.map((provider) => (
        <button
          className="relative flex h-11 w-full items-center justify-center rounded-full border border-slate-200 bg-white px-4 text-[13px] font-normal text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.02)] transition-[background-color,border-color,transform] duration-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
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
