"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, HandHeart } from "lucide-react";
import Link from "next/link";
import { Button, Field, Input, Logo } from "@/components/ui";
import { errorText, homeFor, useAuth } from "@/lib/auth";

export default function DonorLogin() {
  const router = useRouter();
  const { loginDonor } = useAuth();
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
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <HandHeart size={14} /> Donor Portal
          </span>
          <h1 className="mt-3 text-center text-2xl font-semibold text-ink sm:text-[28px]">
            Donor Sign In
          </h1>
          <p className="mt-1 text-center text-sm text-ink-muted">
            Pledge relief supplies and track proof of delivery
          </p>
        </div>

        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              router.push(homeFor(await loginDonor(email, password)));
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Donor Email Address">
            <Input
              type="email"
              placeholder="nimal@example.com"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          
          <Field label="Password">
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
            <Link href="/forgot-password?who=donor" className="text-brand-700 hover:underline">Forgot password?</Link>
          </div>

          {error && <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full py-3 text-base font-medium">
            {busy ? "Signing in..." : "Sign In to Donor Portal"}
          </Button>

          <p className="text-center text-sm text-ink-soft">
            New donor?{" "}
            <Link href="/donor/register" className="font-semibold text-brand-700 hover:underline">
              Create an account
            </Link>
          </p>
        </form>

        <div className="mt-8 border-t border-line pt-6 text-center">
          <p className="text-xs text-ink-muted">
            Are you a member of the relief organization?
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
