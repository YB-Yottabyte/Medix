"use client";

import { useSignIn } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AuthForm,
  VerificationCodeForm,
} from "@/components/chat/auth-form";
import { OAuthButtons } from "@/components/chat/oauth-buttons";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { clerkErrorMessage } from "@/lib/auth/clerk-errors";
import { generateUUID } from "@/lib/utils";

export function ClerkLoginForm() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [needsEmailCode, setNeedsEmailCode] = useState(false);

  const finishSignIn = async () => {
    const destination = `/chat/${generateUUID()}`;
    setIsSuccessful(true);
    const { error } = await signIn.finalize({
      navigate: ({ session, decorateUrl }) => {
        if (session?.currentTask) {
          toast({
            type: "error",
            description: "Please complete the additional account verification.",
          });
          return;
        }

        const url = decorateUrl(destination);
        if (url.startsWith("http")) {
          window.location.href = url;
        } else {
          router.push(url);
          router.refresh();
        }
      },
    });
    if (error) {
      setIsSuccessful(false);
      toast({ type: "error", description: clerkErrorMessage(error) });
    }
  };

  const handleSubmit = async (formData: FormData) => {
    const emailAddress = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setEmail(emailAddress);

    const { error } = await signIn.password({ emailAddress, password });
    if (error) {
      toast({
        type: "error",
        description: clerkErrorMessage(error, "Invalid email or password."),
      });
      return;
    }

    if (signIn.status === "complete") {
      await finishSignIn();
      return;
    }

    if (
      signIn.status === "needs_client_trust" ||
      signIn.status === "needs_second_factor"
    ) {
      const supportsEmailCode = signIn.supportedSecondFactors.some(
        (factor) => factor.strategy === "email_code"
      );
      if (supportsEmailCode) {
        const result = await signIn.mfa.sendEmailCode();
        if (!result.error) {
          setNeedsEmailCode(true);
          return;
        }
        toast({
          type: "error",
          description: clerkErrorMessage(result.error),
        });
        return;
      }
    }

    toast({
      type: "error",
      description: "This account requires an additional sign-in method.",
    });
  };

  const handleVerify = async (formData: FormData) => {
    const code = String(formData.get("code") ?? "").trim();
    const { error } = await signIn.mfa.verifyEmailCode({ code });
    if (error) {
      toast({ type: "error", description: clerkErrorMessage(error) });
      return;
    }
    if (signIn.status === "complete") {
      await finishSignIn();
    }
  };

  return (
    <>
      <div className="text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[30px]">
          Welcome back
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-slate-500">
          Log in to continue your Medix conversations.
        </p>
      </div>

      {needsEmailCode ? (
        <VerificationCodeForm action={handleVerify} email={email}>
          <SubmitButton isSuccessful={isSuccessful} pendingText="Verifying…">
            Verify
          </SubmitButton>
        </VerificationCodeForm>
      ) : (
        <AuthForm
          action={handleSubmit}
          defaultEmail={email}
          passwordAutoComplete="current-password"
        >
          <SubmitButton isSuccessful={isSuccessful} pendingText="Signing in…">
            Sign in
          </SubmitButton>
          <p className="text-center text-[12.5px] text-slate-500">
            {"New to Medix? "}
            <Link
              className="font-medium text-slate-950 transition-opacity hover:opacity-60"
              href="/register"
            >
              Create an account
            </Link>
          </p>
          <OAuthButtons mode="sign-in" />
        </AuthForm>
      )}
    </>
  );
}
