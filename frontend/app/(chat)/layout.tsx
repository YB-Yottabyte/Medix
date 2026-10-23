import Script from "next/script";
import { Suspense } from "react";
import { DataStreamProvider } from "@/components/chat/data-stream-provider";
import { ChatAppFrame } from "@/components/chat/layout/chat-app-frame";
import { getAppSession } from "@/lib/dev-session";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script
        src="https://cdn.jsdelivr.net/pyodide/v0.23.4/full/pyodide.js"
        strategy="lazyOnload"
      />
      <DataStreamProvider>
        <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
          <SidebarShell>{children}</SidebarShell>
        </Suspense>
      </DataStreamProvider>
    </>
  );
}

async function SidebarShell({ children }: { children: React.ReactNode }) {
  const session = await getAppSession();

  return (
    <ChatAppFrame defaultSidebarOpen={false} user={session?.user}>
      {children}
    </ChatAppFrame>
  );
}
