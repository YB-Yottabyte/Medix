import { Input } from "../ui/input";
import { Label } from "../ui/label";

export function AuthForm({
  action,
  children,
  defaultEmail = "",
  passwordAutoComplete = "current-password",
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  defaultEmail?: string;
  passwordAutoComplete?: "current-password" | "new-password";
}) {
  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      <div className="flex flex-col gap-2.5">
        <Label
          className="text-[12.5px] font-medium text-slate-700"
          htmlFor="email"
        >
          Email
        </Label>
        <Input
          autoComplete="email"
          autoFocus
          className="h-12 rounded-xl border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-950/5"
          defaultValue={defaultEmail}
          id="email"
          name="email"
          placeholder="name@example.com"
          required
          type="email"
        />
      </div>

      <div className="flex flex-col gap-2.5">
        <Label
          className="text-[12.5px] font-medium text-slate-700"
          htmlFor="password"
        >
          Password
        </Label>
        <Input
          autoComplete={passwordAutoComplete}
          className="h-12 rounded-xl border-slate-200 bg-white px-3.5 text-[13.5px] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-950/5"
          id="password"
          name="password"
          placeholder="••••••••"
          required
          type="password"
        />
      </div>

      {children}
    </form>
  );
}

export function VerificationCodeForm({
  action,
  children,
  email,
}: {
  action: NonNullable<
    string | ((formData: FormData) => void | Promise<void>) | undefined
  >;
  children: React.ReactNode;
  email: string;
}) {
  return (
    <form action={action} className="mt-8 flex flex-col gap-5">
      <p className="text-center text-[12.5px] leading-5 text-slate-500">
        Enter the verification code sent to {email}.
      </p>
      <div className="flex flex-col gap-2.5">
        <Label
          className="text-[12.5px] font-medium text-slate-700"
          htmlFor="code"
        >
          Verification code
        </Label>
        <Input
          autoComplete="one-time-code"
          autoFocus
          className="h-12 rounded-xl border-slate-200 bg-white px-3.5 text-center text-[15px] tracking-[0.28em] text-slate-950 shadow-[0_1px_2px_rgba(15,23,42,0.03)] outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus-visible:border-slate-400 focus-visible:ring-2 focus-visible:ring-slate-950/5"
          id="code"
          inputMode="numeric"
          maxLength={8}
          name="code"
          placeholder="000000"
          required
          type="text"
        />
      </div>
      {children}
    </form>
  );
}
