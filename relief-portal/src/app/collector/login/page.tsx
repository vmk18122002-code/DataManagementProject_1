"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Eye, EyeOff, Truck } from "lucide-react";
import Link from "next/link";
import { Button, Field, Input, Logo } from "@/components/ui";
import { errorText, homeFor, useAuth } from "@/lib/auth";

export default function CollectorLoginPage() {
  return (
    <Suspense>
      <CollectorLogin />
    </Suspense>
  );
}

/** Sign in for collectors. /collector/login?changed=1 after a collector has replaced their temporary password. */
function CollectorLogin() {
  const router = useRouter();
  const changed = useSearchParams().get("changed") === "1";
  const { loginOrg } = useAuth();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50/60 px-4 py-10">
      <div className="w-full max-w-[480px] rounded-3xl bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.08)] sm:p-10 border border-gray-100">
        <Logo className="justify-center" />

        <div className="mt-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
            <Truck size={14} /> Collector Portal
          </span>
          <h1 className="mt-3 text-center text-2xl font-semibold text-ink sm:text-[28px]">
            Collector Sign In
          </h1>
          <p className="mt-1 text-center text-sm text-ink-muted">
            {changed
              ? "Sign in with your email and the new password you just chose"
              : "Pick up donations and bring them to your drop-off point"}
          </p>
        </div>

        {changed && (
          <p role="status" className="mt-6 rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-700">
            Your new password is saved. Sign in with it to open the Collector Portal.
          </p>
        )}

        <form
          className={changed ? "mt-5 space-y-5" : "mt-8 space-y-5"}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              router.push(homeFor(await loginOrg(email, password)));
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Email Address">
            <Input
              type="email"
              placeholder="collector@example.com"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>

          <Field label="Password" hint={changed ? undefined : "First time? Use the temporary password from your email."}>
            <div className="relative">
              <Input
                type={show ? "text" : "password"}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-11"
                required
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink transition-colors"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <Eye size={20} /> : <EyeOff size={20} />}
              </button>
            </div>
          </Field>

          <div className="flex items-center justify-between text-sm">
            <Link href="/forgot-password?who=collector" className="text-brand-700 hover:underline">Forgot password?</Link>
          </div>

          {error && <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full py-3 text-base font-medium">
            {busy ? "Signing in..." : "Sign In to Collector Portal"}
          </Button>
        </form>

        <div className="mt-8 border-t border-line pt-6 text-center">
          <p className="text-xs text-ink-muted">
            Are you an organization admin?
          </p>
          <Link
            href="/"
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700 hover:underline"
          >
            &larr; Go to Organization Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
