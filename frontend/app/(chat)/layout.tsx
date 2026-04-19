import { cookies } from "next/headers";
import { Suspense } from "react";
import { ChatAppFrame } from "@/components/chat/chat-app-frame";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { getAppSession } from "@/lib/dev-session";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DataStreamProvider>
      <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
        <SidebarShell>{children}</SidebarShell>
      </Suspense>
    </DataStreamProvider>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const [session, cookieStore] = await Promise.all([getAppSession(), cookies()]);
  const isCollapsed = cookieStore.get("sidebar_state")?.value !== "true";

  return (
    <ChatAppFrame defaultSidebarOpen={!isCollapsed} user={session?.user}>
      {children}
    </ChatAppFrame>
  );
}
