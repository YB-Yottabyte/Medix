"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useActionState, useEffect, useState } from "react";
import { type RegisterActionState, register } from "@/app/(auth)/actions";
import { AuthForm } from "@/components/chat/auth-form";
import { OAuthButtons } from "@/components/chat/oauth-buttons";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";

export function LegacyRegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [state, formAction] = useActionState<RegisterActionState, FormData>(
    register,
    { status: "idle" }
  );
  const { update: updateSession } = useSession();

  useEffect(() => {
    if (state.status === "user_exists") {
      toast({ description: "Account already exists!", type: "error" });
    } else if (state.status === "failed") {
      toast({ description: "Failed to create account!", type: "error" });
    } else if (state.status === "invalid_data") {
      toast({
        description: "Failed validating your submission!",
        type: "error",
      });
    } else if (state.status === "success") {
      toast({ description: "Account created!", type: "success" });
      setIsSuccessful(true);
      updateSession();
      router.refresh();
    }
  }, [router, state.status, updateSession]);

  return (
    <>
      <div className="text-center">
        <h1 className="font-semibold text-[28px] text-slate-950 tracking-[-0.04em] sm:text-[30px]">
          Create your account
        </h1>
        <p className="mt-2 text-[13px] text-slate-500 leading-5">
          Save chats and continue your Medix research anywhere.
        </p>
      </div>
      <AuthForm
        action={(formData) => {
          setEmail(String(formData.get("email") ?? ""));
          formAction(formData);
        }}
        defaultEmail={email}
        passwordAutoComplete="new-password"
      >
        <SubmitButton isSuccessful={isSuccessful}>Sign up</SubmitButton>
        <p className="text-center text-[12.5px] text-slate-500">
          {"Already have an account? "}
          <Link
            className="font-medium text-slate-950 transition-opacity hover:opacity-60"
            href="/login"
          >
            Log in
          </Link>
        </p>
        <OAuthButtons mode="legacy" />
      </AuthForm>
    </>
  );
}
