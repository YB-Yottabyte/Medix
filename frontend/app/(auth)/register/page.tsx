import { ClerkRegisterForm } from "@/components/chat/clerk-register-form";
import { LegacyRegisterForm } from "@/components/chat/legacy-register-form";
import { isClerkConfigured } from "@/lib/auth/config";

export default function Page() {
  return isClerkConfigured() ? <ClerkRegisterForm /> : <LegacyRegisterForm />;
}
