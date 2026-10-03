"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button, Field, Input, Logo } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText } from "@/lib/auth";

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPassword />
    </Suspense>
  );
}

/** /forgot-password?who=donor for donors, ?who=collector for collectors, otherwise organization members. */
function ForgotPassword() {
  const who = useSearchParams().get("who");
  const kind = who === "donor" ? "donor" : "org"; // collectors are organization accounts
  const login = who === "donor" ? "/donor/login" : who === "collector" ? "/collector/login" : "/";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50/60 px-4 py-10">
      <div className="w-full max-w-[480px] rounded-3xl bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.08)] sm:p-10 border border-gray-100">
        <Logo className="justify-center" />

        {sent ? (
          <div className="mt-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50">
              <MailCheck size={30} className="text-brand-600" />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-ink">Check Your Email</h1>
            <p className="mt-2 text-sm text-ink-soft">
              If <b>{email}</b> has a {kind === "donor" ? "donor" : "ReliefHub organization"} account, we have emailed a
              temporary password to it. Sign in with that password and you will be asked to choose a new one.
            </p>
            <p className="mt-2 text-xs text-ink-muted">No email after a few minutes? Check the spam folder, then try again.</p>
            <Link href={login} className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-3 font-medium text-white hover:bg-brand-700">
              Back to Sign In
            </Link>
          </div>
        ) : (
          <>
            <div className="mt-6 text-center">
              <h1 className="text-2xl font-semibold text-ink sm:text-[28px]">Forgot Password</h1>
              <p className="mt-1 text-sm text-ink-muted">
                Enter the email of your {kind === "donor" ? "donor" : "organization or collector"} account and we will email you a temporary password.
              </p>
            </div>

            <form
              className="mt-8 space-y-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api.forgotPassword(kind, email);
                  setSent(true);
                } catch (err) {
                  setError(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="Email Address">
                <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>

              {error && <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

              <Button type="submit" disabled={busy} className="w-full py-3 text-base font-medium">
                {busy ? "Sending..." : "Email Me a Temporary Password"}
              </Button>

              <p className="text-center text-sm text-ink-soft">
                <Link href={login} className="font-semibold text-brand-700 hover:underline">&larr; Back to Sign In</Link>
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
