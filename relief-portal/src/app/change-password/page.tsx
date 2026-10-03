"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button, Field, Input, Logo } from "@/components/ui";
import { errorText, homeFor, useAuth } from "@/lib/auth";

/** Shown after signing in with a temporary password: the account picks its own password before using the portal. */
export default function ChangePassword() {
  const router = useRouter();
  const { user, changePassword, logout } = useAuth();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // not signed in -> sign in first; password already chosen -> nothing to do here
  useEffect(() => {
    if (busy) return; // saving: the form decides where to go next
    if (user === null) router.replace("/");
    // the stored session says nothing about how it signed in after a reload; the server does (see AuthProvider)
    else if (user && !user.mustChangePassword) router.replace(homeFor(user));
  }, [user, busy, router]);
  if (!user?.mustChangePassword && !busy) return null;

  const mismatch = confirm.length > 0 && next !== confirm;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50/60 px-4 py-10">
      <div className="w-full max-w-[480px] rounded-3xl bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.08)] sm:p-10 border border-gray-100">
        <Logo className="justify-center" />

        <div className="mt-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <KeyRound size={14} /> Temporary password
          </span>
          <h1 className="mt-3 text-center text-2xl font-semibold text-ink sm:text-[28px]">Choose Your Password</h1>
          <p className="mt-1 text-center text-sm text-ink-muted">
            Welcome{user ? `, ${user.name}` : ""}. You signed in with a temporary password. Choose your own password to continue.
          </p>
        </div>

        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== confirm) return setError("The two passwords do not match.");
            setBusy(true);
            setError("");
            try {
              const saved = await changePassword(next);
              if (saved.role === "collector") {
                // a collector signs in again with the password they just chose
                logout();
                router.replace("/collector/login?changed=1");
              } else router.push(homeFor(saved));
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <Field label="New password" hint="At least 8 characters">
            <div className="relative">
              <Input
                type={show ? "text" : "password"} autoComplete="new-password" minLength={8} maxLength={72}
                value={next} onChange={(e) => setNext(e.target.value)} className="pr-11" required
              />
              <button
                type="button" onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
          </Field>

          <Field label="Confirm new password">
            <Input
              type={show ? "text" : "password"} autoComplete="new-password" maxLength={72}
              value={confirm} onChange={(e) => setConfirm(e.target.value)} required
            />
          </Field>

          {(mismatch || error) && (
            <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">
              {mismatch ? "The two passwords do not match." : error}
            </p>
          )}

          <Button type="submit" disabled={busy || mismatch} className="w-full py-3 text-base font-medium">
            {busy ? "Saving..." : "Save Password and Continue"}
          </Button>

          <p className="text-center text-sm text-ink-soft">
            <button
              type="button"
              onClick={() => {
                const login = user?.role === "collector" ? "/collector/login" : user?.role === "donor" ? "/donor/login" : "/";
                setBusy(true); // keeps the effect above from sending everyone to the organization sign in
                logout();
                router.replace(login);
              }}
              className="font-semibold text-brand-700 hover:underline"
            >
              Sign out
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}
