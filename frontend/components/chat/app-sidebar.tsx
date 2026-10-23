"use client";

import { SearchIcon, SquarePenIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SidebarHistory } from "@/components/chat/sidebar-history";
import { SidebarUserNav } from "@/components/chat/sidebar-user-nav";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import type { AppUser } from "@/lib/auth/types";
import { isLocalAuthBypassed } from "@/lib/constants";
import { generateUUID } from "@/lib/utils";
import { MedixBrand } from "./medix-brand";

export function AppSidebar({ user }: { user: AppUser | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const isGuest = !user || isLocalAuthBypassed || user.type === "guest";

  return (
    <Sidebar className="border-slate-200/70 border-r" collapsible="offcanvas">
      <SidebarHeader className="px-3 pt-3.5 pb-1">
        <div className="flex h-10 items-center justify-between gap-3 px-2">
          <Link
            aria-label="Medix home"
            className="font-semibold text-[17px] text-foreground tracking-[-0.04em] transition-opacity hover:opacity-70"
            href="/"
            onClick={() => setOpenMobile(false)}
          >
            <MedixBrand className="text-[21px]" />
          </Link>
          <div className="flex items-center gap-0.5">
            <Button
              aria-expanded={searchOpen}
              aria-label="Search chats"
              className="size-8 rounded-lg text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              onClick={() => {
                setSearchOpen((current) => !current);
                if (searchOpen) {
                  setSearchQuery("");
                }
              }}
              size="icon-sm"
              variant="ghost"
            >
              <SearchIcon className="size-4" strokeWidth={1.8} />
            </Button>
            <SidebarTrigger className="size-8 rounded-lg text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          </div>
        </div>
        {searchOpen && (
          <div className="relative px-1 pt-1 pb-1.5">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-3.5 left-4 size-3.5 text-sidebar-foreground/40"
              strokeWidth={1.8}
            />
            <input
              aria-label="Search chat history"
              autoFocus
              className="h-9 w-full rounded-lg border border-sidebar-border/70 bg-white pr-3 pl-9 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-sidebar-foreground/40 focus:border-sidebar-foreground/25"
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setSearchOpen(false);
                  setSearchQuery("");
                }
              }}
              placeholder="Search chats"
              value={searchQuery}
            />
          </div>
        )}
      </SidebarHeader>

      <SidebarContent className="gap-0 px-2">
        <SidebarGroup className="px-1 pt-2 pb-3">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  className="h-9 rounded-lg px-2.5 font-medium text-[13px] text-sidebar-foreground/85 transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  onClick={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                    setOpenMobile(false);
                    router.push(`/chat/${generateUUID()}`);
                  }}
                >
                  <SquarePenIcon className="size-[17px]" strokeWidth={1.8} />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarHistory
          searchQuery={searchQuery}
          user={isGuest ? undefined : user}
        />
      </SidebarContent>

      {isGuest ? (
        <SidebarFooter className="border-slate-200/70 border-t px-3 pt-4 pb-4">
          <div className="px-1 font-sans">
            <h2 className="font-semibold text-[12px] text-foreground leading-5 tracking-[-0.01em]">
              Get responses tailored to you
            </h2>
            <p className="mt-2 text-[11px] text-sidebar-foreground/65 leading-[1.48]">
              Sign in to save and revisit your Medix conversations.
            </p>
            <Link
              className="medix-blue-sweep relative mt-4 flex h-9 w-full items-center justify-center rounded-xl font-medium text-[12px]"
              href="/login"
              onClick={() => setOpenMobile(false)}
            >
              <span className="relative z-10">Log in</span>
            </Link>
          </div>
        </SidebarFooter>
      ) : (
        <SidebarFooter className="px-3 pt-2 pb-3">
          <SidebarUserNav user={user} />
        </SidebarFooter>
      )}
      <SidebarRail />
    </Sidebar>
  );
}
