"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HandHeart } from "lucide-react";
import Link from "next/link";
import { Button, Field, Input, Logo } from "@/components/ui";
import { errorText, useAuth } from "@/lib/auth";

export default function DonorRegister() {
  const router = useRouter();
  const { registerDonor } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50/60 px-4 py-10">
      <div className="w-full max-w-[480px] rounded-3xl bg-white p-8 shadow-[0_8px_30px_rgba(0,0,0,0.08)] sm:p-10 border border-gray-100">
        <Logo className="justify-center" />

        <div className="mt-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <HandHeart size={14} /> Donor Portal
          </span>
          <h1 className="mt-3 text-center text-2xl font-semibold text-ink sm:text-[28px]">
            Create a Donor Account
          </h1>
          <p className="mt-1 text-center text-sm text-ink-muted">
            You give your pickup address and district when you donate
          </p>
        </div>

        <form
          className="mt-8 space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await registerDonor(form);
              router.push("/donor/donate");
            } catch (err) {
              setError(errorText(err));
              setBusy(false);
            }
          }}
        >
          <Field label="Full Name or Organisation">
            <Input placeholder="Nimal Perera" autoComplete="name" value={form.name} onChange={set("name")} required />
          </Field>

          <Field label="Email Address">
            <Input type="email" placeholder="nimal@example.com" autoComplete="username" value={form.email} onChange={set("email")} required />
          </Field>

          <Field label="Password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" minLength={8} maxLength={72} value={form.password} onChange={set("password")} required />
          </Field>

          <Field label="Phone">
            <Input type="tel" placeholder="077 123 4567" autoComplete="tel" value={form.phone} onChange={set("phone")} required />
          </Field>


          {error && <p role="alert" className="rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">{error}</p>}

          <Button type="submit" disabled={busy} className="w-full py-3 text-base font-medium">
            {busy ? "Creating account..." : "Create Account"}
          </Button>

          <p className="text-center text-sm text-ink-soft">
            Already have an account?{" "}
            <Link href="/donor/login" className="font-semibold text-brand-700 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
