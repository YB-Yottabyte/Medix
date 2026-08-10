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

export function AppSidebar({ user }: { user: AppUser | undefined }) {
  const router = useRouter();
  const { setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const isGuest = !user || isLocalAuthBypassed || user.type === "guest";

  return (
    <Sidebar className="border-r border-slate-200/70" collapsible="offcanvas">
      <SidebarHeader className="px-3 pt-3.5 pb-1">
        <div className="flex h-10 items-center justify-between gap-3 px-2">
          <Link
            className="text-[17px] font-semibold tracking-[-0.04em] text-foreground transition-opacity hover:opacity-70"
            href="/"
            onClick={() => setOpenMobile(false)}
          >
            Medix
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
                  className="h-9 rounded-lg px-2.5 text-[13px] font-medium text-sidebar-foreground/85 transition-colors duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
        <SidebarFooter className="border-t border-slate-200/70 px-3 pt-4 pb-4">
          <div className="px-1 font-sans">
            <h2 className="text-[12px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
              Get responses tailored to you
            </h2>
            <p className="mt-2 text-[11px] leading-[1.48] text-sidebar-foreground/65">
              Log in to get answers based on saved chats, plus create images and
              upload files.
            </p>
            <Link
              className="group/login relative mt-4 flex h-9 w-full items-center justify-center overflow-hidden rounded-full border border-sidebar-border bg-white text-[12px] font-medium text-slate-950 transition-colors duration-500 hover:text-white"
              href="/login"
              onClick={() => setOpenMobile(false)}
            >
              <span className="absolute inset-0 bg-slate-950 [clip-path:polygon(0_100%,0_100%,0_100%)] transition-[clip-path] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/login:[clip-path:polygon(0_100%,0_-100%,200%_100%)]" />
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
