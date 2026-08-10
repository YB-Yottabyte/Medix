"use client";

import {
  ChevronUp,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  UserRoundIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { AppUser } from "@/lib/auth/types";
import { isLocalAuthBypassed } from "@/lib/constants";
import { ClerkAccountDialogs } from "./account-settings";
import { useMedixAuth } from "./auth-state-provider";
import { LoaderIcon } from "./icons";
import { toast } from "./toast";

const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function emailToHue(email: string): number {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

export function SidebarUserNav({ user }: { user: AppUser }) {
  const router = useRouter();
  const { isAuthenticated, isLoaded, signOut, user: authUser } = useMedixAuth();
  const { setTheme, resolvedTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const isGuest = isLocalAuthBypassed || !isAuthenticated;
  const email = authUser?.email ?? user.email;

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {isLoaded ? (
                <SidebarMenuButton
                  className="h-8 px-2 rounded-lg bg-transparent text-sidebar-foreground/70 transition-colors duration-150 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-testid="user-nav-button"
                >
                  <div
                    className="size-5 shrink-0 overflow-hidden rounded-full ring-1 ring-sidebar-border/50"
                    style={{
                      background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(email ?? "")}), oklch(0.25 0.05 ${emailToHue(email ?? "") + 40}))`,
                    }}
                  >
                    {authUser?.image && (
                      // biome-ignore lint/performance/noImgElement: Clerk provides the optimized profile image URL.
                      <img
                        alt=""
                        className="size-full object-cover"
                        src={authUser.image}
                      />
                    )}
                  </div>
                  <span
                    className="truncate text-[13px]"
                    data-testid="user-email"
                  >
                    {isGuest ? "Guest" : email}
                  </span>
                  <ChevronUp className="ml-auto size-3.5 text-sidebar-foreground/50" />
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton className="h-10 justify-between rounded-lg bg-transparent text-sidebar-foreground/50 transition-colors duration-150 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <div className="flex flex-row items-center gap-2">
                    <div className="size-6 animate-pulse rounded-full bg-sidebar-foreground/10" />
                    <span className="animate-pulse rounded-md bg-sidebar-foreground/10 text-transparent text-[13px]">
                      Loading...
                    </span>
                  </div>
                  <div className="animate-spin text-sidebar-foreground/50">
                    <LoaderIcon />
                  </div>
                </SidebarMenuButton>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-(--radix-popper-anchor-width) rounded-lg border border-border/60 bg-card/95 backdrop-blur-xl shadow-[var(--shadow-float)]"
              data-testid="user-nav-menu"
              side="top"
            >
              {!isGuest && clerkEnabled && (
                <>
                  <DropdownMenuItem
                    className="cursor-pointer text-[13px]"
                    onSelect={() =>
                      window.setTimeout(() => setProfileOpen(true), 0)
                    }
                  >
                    <UserRoundIcon className="size-4" strokeWidth={1.7} />
                    Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer text-[13px]"
                    onSelect={() =>
                      window.setTimeout(() => setSettingsOpen(true), 0)
                    }
                  >
                    <SettingsIcon className="size-4" strokeWidth={1.7} />
                    Settings
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem
                className="cursor-pointer text-[13px]"
                data-testid="user-nav-item-theme"
                onSelect={() =>
                  setTheme(resolvedTheme === "dark" ? "light" : "dark")
                }
              >
                <MoonIcon className="size-4" strokeWidth={1.7} />
                Toggle dark mode
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-[13px]"
                data-testid="user-nav-item-auth"
                onSelect={async () => {
                  if (!isLoaded) {
                    toast({
                      type: "error",
                      description:
                        "Checking authentication status, please try again!",
                    });
                    return;
                  }

                  if (isLocalAuthBypassed) {
                    toast({
                      type: "success",
                      description: "Local dev auth bypass is enabled.",
                    });
                  } else if (isGuest) {
                    router.push("/login");
                  } else {
                    await signOut();
                  }
                }}
              >
                <LogOutIcon className="size-4" strokeWidth={1.7} />
                {isLocalAuthBypassed
                  ? "Local dev mode"
                  : isGuest
                    ? "Login to your account"
                    : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      {!isGuest && clerkEnabled && (
        <ClerkAccountDialogs
          onProfileOpenChange={setProfileOpen}
          onSettingsOpenChange={setSettingsOpen}
          profileOpen={profileOpen}
          settingsOpen={settingsOpen}
        />
      )}
    </>
  );
}
