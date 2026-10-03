"use client";

/*
  Who is signed in. The login token (JWT) and user come from the backend and are kept by `session` in lib/api.ts.
  `user` is undefined until the browser has read the stored session, null when signed out.
*/
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { ApiError, AuthUser, DonorSignup, Role, api, session } from "./api";

interface AuthState {
  user: AuthUser | null | undefined;
  loginDonor: (email: string, password: string) => Promise<AuthUser>;
  loginOrg: (email: string, password: string) => Promise<AuthUser>;
  registerDonor: (d: DonorSignup) => Promise<AuthUser>;
  /** currentPassword is not needed while the account still has its temporary password */
  changePassword: (newPassword: string, currentPassword?: string) => Promise<AuthUser>;
  logout: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const current = useSyncExternalStore(session.subscribe, session.get, () => undefined);
  const token = current?.token;

  // check the stored token with the API: refreshes the profile, signs out if the token expired or the account is gone
  useEffect(() => {
    if (!token) return;
    api.me().then((user) => session.get()?.token === token && session.set({ token, user }))
      .catch((e) => e instanceof ApiError && e.status === 401 && session.set(null));
  }, [token]);

  const value = useMemo<AuthState>(() => {
    const start = async (p: Promise<{ token: string; user: AuthUser }>) => {
      const s = await p;
      session.set(s);
      return s.user;
    };
    return {
      user: current === undefined ? undefined : current?.user ?? null,
      loginDonor: (email, password) => start(api.loginDonor(email, password)),
      loginOrg: (email, password) => start(api.loginOrg(email, password)),
      registerDonor: (d) => start(api.registerDonor(d)),
      changePassword: (n, c) => start(api.changePassword(n, c)),
      logout: () => session.set(null),
    };
  }, [current]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

/**
 * For portal layouts: returns the signed-in user when their role is allowed, otherwise null and sends the browser
 * to `login`. Pass enabled = false on pages that need no sign in (the login page itself).
 */
export function useRequireAuth(roles: Role[], login: string, enabled = true): AuthUser | null {
  const { user } = useAuth();
  const router = useRouter();
  const mustChange = !!user?.mustChangePassword;
  const allowed = !!user && roles.includes(user.role) && !mustChange;
  useEffect(() => {
    if (enabled && user !== undefined && !allowed) router.replace(mustChange ? "/change-password" : login);
  }, [enabled, user, allowed, mustChange, login, router]);
  return allowed ? user : null;
}

/** Where a user lands after signing in. */
export const homeFor = (u: AuthUser) =>
  u.mustChangePassword ? "/change-password" : u.role === "donor" ? "/donor/donate" : u.role === "collector" ? "/collector" : "/coordinator";

/** The signed-in donor's profile, for pages inside the donor portal. */
export function useDonor() {
  const { user } = useAuth();
  return {
    id: user?.id ?? "", name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "",
    address: user?.address ?? "", district: user?.district || "Colombo",
  };
}

/**
 * The signed-in collector. `store` is where they bring what they collect: their drop-off point.
 * An organization admin can open the collector portal too, but has no district or drop-off point of their own.
 */
export function useCollector() {
  const { user } = useAuth();
  const org = user?.org || "ReliefHub";
  const district = user?.district || "Colombo";
  return {
    name: user?.name ?? "", org, district,
    store: user?.dropoff ? `${user.dropoff.name}, ${user.dropoff.address}` : `${org} Store Room - ${district}`,
  };
}

export const errorText = (e: unknown) =>
  e instanceof ApiError ? e.message : "Cannot reach the ReliefHub server. Check that the backend is running.";
