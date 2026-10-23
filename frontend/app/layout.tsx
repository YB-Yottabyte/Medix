import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthStateProvider } from "@/components/chat/auth-state-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isClerkConfigured } from "@/lib/auth/config";

import "./globals.css";

export const metadata: Metadata = {
  description: "Multimodal medical video question answering assistant.",
  metadataBase: new URL(
    process.env.RENDER_EXTERNAL_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000"
  ),
  title: "Medix",
};

export const viewport = {
  maximumScale: 1,
};

const geistSans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkEnabled = isClerkConfigured();
  const application = (
    <AuthStateProvider clerkEnabled={clerkEnabled}>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        disableTransitionOnChange
        enableSystem
      >
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </AuthStateProvider>
  );

  return (
    <html
      className={`${geistSans.variable} ${geistMono.variable}`}
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="font-sans antialiased">
        {clerkEnabled ? (
          <ClerkProvider
            signInFallbackRedirectUrl="/"
            signInUrl="/login"
            signUpFallbackRedirectUrl="/"
            signUpUrl="/register"
          >
            {application}
          </ClerkProvider>
        ) : (
          application
        )}
      </body>
    </html>
  );
}
