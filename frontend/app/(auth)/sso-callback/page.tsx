import { redirect } from "next/navigation";
import { ClerkSsoCallback } from "@/components/chat/clerk-sso-callback";
import { isClerkConfigured } from "@/lib/auth/config";

export default function SsoCallbackPage() {
  if (!isClerkConfigured()) {
    redirect("/login");
  }

  return <ClerkSsoCallback />;
}
