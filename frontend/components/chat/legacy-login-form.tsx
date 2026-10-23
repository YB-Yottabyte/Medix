"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { type LoginActionState, login } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/chat/auth-form";
import { OAuthButtons } from "@/components/chat/oauth-buttons";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

export function LegacyLoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<LoginActionState, FormData>(
    login,
    { status: "idle" }
  );
  const { update: updateSession } = useSession();

  useEffect(() => {
    if (state.status === "failed") {
      toast({ description: "Invalid credentials!", type: "error" });
    } else if (state.status === "invalid_data") {
      toast({
        description: "Failed validating your submission!",
        type: "error",
      });
    } else if (state.status === "success") {
      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [router, state.status, updateSession]);

  return (
    <>
      <div className="text-center">
        <h1 className="font-semibold text-[28px] text-slate-950 tracking-[-0.04em] sm:text-[30px]">
          Welcome back
        </h1>
        <p className="mt-2 text-[13px] text-slate-500 leading-5">
          Log in to continue your Medix conversations.
        </p>
      </div>
      <AuthForm
        action={(formData) => {
          setEmail(String(formData.get("email") ?? ""));
          formAction(formData);
        }}
        defaultEmail={email}
        passwordAutoComplete="current-password"
      >
        <SubmitButton isSuccessful={isSuccessful}>Sign in</SubmitButton>
        <p className="text-center text-[12.5px] text-slate-500">
          {"New to Medix? "}
          <Link
            className="font-medium text-slate-950 transition-opacity hover:opacity-60"
            href="/register"
          >
            Create an account
          </Link>
        </p>
        <OAuthButtons mode="legacy" />
      </AuthForm>
    </>
  );
}
