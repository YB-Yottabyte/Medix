"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import {
  signOut as nextAuthSignOut,
  SessionProvider,
  useSession,
} from "next-auth/react";
import { createContext, useContext, useMemo } from "react";
import { guestRegex, isLocalAuthBypassed } from "@/lib/constants";

type ClientAuthUser = {
  email: string | null;
  name: string | null;
  image: string | null;
};

type AuthState = {
  isLoaded: boolean;
  isAuthenticated: boolean;
  user: ClientAuthUser | null;
  signOut: () => Promise<void>;
};

const AuthStateContext = createContext<AuthState | null>(null);

export function AuthStateProvider({
  children,
  clerkEnabled,
}: {
  children: React.ReactNode;
  clerkEnabled: boolean;
}) {
  if (clerkEnabled) {
    return <ClerkAuthBridge>{children}</ClerkAuthBridge>;
  }

  return (
    <SessionProvider
      basePath={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/auth`}
    >
      <LegacyAuthBridge>{children}</LegacyAuthBridge>
    </SessionProvider>
  );
}

function ClerkAuthBridge({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();
  const medixDisplayName =
    typeof user?.unsafeMetadata.medixDisplayName === "string"
      ? user.unsafeMetadata.medixDisplayName
      : null;
  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: Boolean(isLoaded && isSignedIn),
      isLoaded,
      signOut: async () => {
        await clerk.signOut({ redirectUrl: "/" });
      },
      user: user
        ? {
            email: user.primaryEmailAddress?.emailAddress ?? null,
            image: user.imageUrl,
            name: medixDisplayName ?? user.fullName,
          }
        : null,
    }),
    [clerk, isLoaded, isSignedIn, medixDisplayName, user]
  );

  return (
    <AuthStateContext.Provider value={value}>
      {children}
    </AuthStateContext.Provider>
  );
}

function LegacyAuthBridge({ children }: { children: React.ReactNode }) {
  const { data, status } = useSession();
  const isGuest =
    isLocalAuthBypassed || guestRegex.test(data?.user?.email ?? "");
  const value = useMemo<AuthState>(
    () => ({
      isAuthenticated: status === "authenticated" && !isGuest,
      isLoaded: status !== "loading",
      signOut: async () => {
        await nextAuthSignOut({ redirectTo: "/" });
      },
      user: data?.user
        ? {
            email: data.user.email ?? null,
            image: data.user.image ?? null,
            name: data.user.name ?? null,
          }
        : null,
    }),
    [data?.user, isGuest, status]
  );

  return (
    <AuthStateContext.Provider value={value}>
      {children}
    </AuthStateContext.Provider>
  );
}

export function useMedixAuth() {
  const value = useContext(AuthStateContext);
  if (!value) {
    throw new Error("useMedixAuth must be used inside AuthStateProvider");
  }
  return value;
}
