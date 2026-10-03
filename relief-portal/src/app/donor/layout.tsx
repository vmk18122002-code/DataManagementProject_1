"use client";

import { usePathname } from "next/navigation";
import { Bell, ClipboardList, HandHeart, HeartHandshake, History, LifeBuoy } from "lucide-react";
import { NavItem, Shell } from "@/components/Shell";
import { AuthUser } from "@/lib/api";
import { useRequireAuth } from "@/lib/auth";
import { useNotices } from "@/lib/notifications";

export default function DonorLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const open = pathname === "/donor/login" || pathname === "/donor/register";
  const user = useRequireAuth(["donor"], "/donor/login", !open);
  if (open) {
    return <>{children}</>;
  }
  if (!user) return null; // checking the session, or on the way to the login page

  return <Portal user={user}>{children}</Portal>;
}

function Portal({ user, children }: { user: AuthUser; children: React.ReactNode }) {
  const { unread } = useNotices(user.id);
  const nav: NavItem[] = [
    { href: "/donor/donate", label: "Donate items", icon: <HandHeart size={20} /> },
    { href: "/donor/donations", label: "Donation status", icon: <ClipboardList size={20} /> },
    { href: "/donor/notifications", label: "Notifications", icon: <Bell size={20} />, badge: unread },
    { href: "/donor/impact", label: "My impact", icon: <HeartHandshake size={20} /> },
    { href: "/donor/history", label: "History", icon: <History size={20} /> },
    { href: "/donor/help", label: "Help & contact", icon: <LifeBuoy size={20} /> },
  ];
  return (
    <Shell nav={nav} user={{ name: user.name, email: user.email, role: "Donor portal" }}>
      {children}
    </Shell>
  );
}
