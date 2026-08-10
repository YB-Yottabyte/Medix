"use client";

import { useSignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthForm, VerificationCodeForm } from "@/components/chat/auth-form";
import { OAuthButtons } from "@/components/chat/oauth-buttons";
import { SubmitButton } from "@/components/chat/submit-button";
import { toast } from "@/components/chat/toast";
import { clerkErrorMessage } from "@/lib/auth/clerk-errors";
import { generateUUID } from "@/lib/utils";

type FormFeedback = {
  type: "error" | "success";
  message: string;
};

export function ClerkRegisterForm() {
  const router = useRouter();
  const { signUp } = useSignUp();
  const [email, setEmail] = useState("");
  const [isSuccessful, setIsSuccessful] = useState(false);
  const [needsEmailCode, setNeedsEmailCode] = useState(false);
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);

  const showError = (error: unknown, fallback?: string) => {
    const message = clerkErrorMessage(error, fallback);
    setIsSuccessful(false);
    setFeedback({ type: "error", message });
    toast({ type: "error", description: message });
  };

  const finishSignUp = async () => {
    const destination = `/chat/${generateUUID()}`;
    setIsSuccessful(true);
    setFeedback({
      type: "success",
      message: "Account created. Signing you in…",
    });

    try {
      const { error } = await signUp.finalize({
        navigate: ({ session, decorateUrl }) => {
          if (session?.currentTask) {
            showError(
              session.currentTask,
              "Your account was created, but Clerk requires one more verification step."
            );
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
        showError(
          error,
          "Your account was created, but sign-in did not finish."
        );
      }
    } catch (error) {
      showError(error, "Your account was created, but sign-in did not finish.");
    }
  };

  const handleSubmit = async (formData: FormData) => {
    const emailAddress = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    setEmail(emailAddress);
    setFeedback(null);

    try {
      const { error } = await signUp.password({ emailAddress, password });
      if (error) {
        showError(error, "Could not create your account.");
        return;
      }

      if (signUp.status === "complete") {
        await finishSignUp();
        return;
      }

      const verification = await signUp.verifications.sendEmailCode();
      if (verification.error) {
        showError(verification.error, "Could not send the verification code.");
        return;
      }
      setNeedsEmailCode(true);
      setFeedback({
        type: "success",
        message: `We sent a verification code to ${emailAddress}.`,
      });
    } catch (error) {
      showError(error, "Could not create your account.");
    }
  };

  const handleVerify = async (formData: FormData) => {
    const code = String(formData.get("code") ?? "").trim();
    setFeedback(null);

    try {
      const { error } = await signUp.verifications.verifyEmailCode({ code });
      if (error) {
        showError(error, "That verification code could not be confirmed.");
        return;
      }
      if (signUp.status === "complete") {
        await finishSignUp();
        return;
      }

      showError(
        signUp.status,
        "Email verified, but Clerk still requires additional account information. Check the required sign-up fields in the Clerk Dashboard."
      );
    } catch (error) {
      showError(error, "That verification code could not be confirmed.");
    }
  };

  const resendCode = async () => {
    setFeedback(null);
    try {
      const { error } = await signUp.verifications.sendEmailCode();
      if (error) {
        showError(error, "Could not send a new verification code.");
        return;
      }
      setFeedback({
        type: "success",
        message: `A new verification code was sent to ${email}.`,
      });
    } catch (error) {
      showError(error, "Could not send a new verification code.");
    }
  };

  return (
    <>
      <div className="text-center">
        <h1 className="text-[28px] font-semibold tracking-[-0.04em] text-slate-950 sm:text-[30px]">
          Create your account
        </h1>
        <p className="mt-2 text-[13px] leading-5 text-slate-500">
          Save chats and continue your Medix research anywhere.
        </p>
      </div>

      {feedback && (
        <p
          aria-live="polite"
          className={`mt-5 rounded-xl border px-3.5 py-3 text-[12.5px] leading-5 ${
            feedback.type === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
          role={feedback.type === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </p>
      )}

      {needsEmailCode ? (
        <VerificationCodeForm action={handleVerify} email={email}>
          <SubmitButton isSuccessful={isSuccessful} pendingText="Verifying…">
            Verify
          </SubmitButton>
          <button
            className="text-center text-[12.5px] font-medium text-slate-600 transition-opacity hover:opacity-60"
            onClick={resendCode}
            type="button"
          >
            Send a new code
          </button>
        </VerificationCodeForm>
      ) : (
        <AuthForm
          action={handleSubmit}
          defaultEmail={email}
          passwordAutoComplete="new-password"
        >
          <div id="clerk-captcha" />
          <p className="-mt-3 text-center text-[11.5px] leading-4 text-slate-400">
            If prompted, complete the human verification above to continue.
          </p>
          <SubmitButton
            isSuccessful={isSuccessful}
            pendingText="Complete verification above"
          >
            Sign up
          </SubmitButton>
          <p className="text-center text-[12.5px] text-slate-500">
            {"Already have an account? "}
            <Link
              className="font-medium text-slate-950 transition-opacity hover:opacity-60"
              href="/login"
            >
              Log in
            </Link>
          </p>
          <OAuthButtons mode="sign-up" />
        </AuthForm>
      )}
    </>
  );
}
