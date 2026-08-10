import { ClerkLoginForm } from "@/components/chat/clerk-login-form";
import { LegacyLoginForm } from "@/components/chat/legacy-login-form";
import { isClerkConfigured } from "@/lib/auth/config";

export default function Page() {
  return isClerkConfigured() ? <ClerkLoginForm /> : <LegacyLoginForm />;
}
