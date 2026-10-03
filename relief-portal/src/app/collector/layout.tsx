"use client";

import { usePathname } from "next/navigation";
import { History,MessageSquareWarning, PackageOpen, Truck } from "lucide-react";
import { Shell } from "@/components/Shell";
import { useCollector, useRequireAuth } from "@/lib/auth";

const NAV = [
  { href: "/collector", label: "Pickups", icon: <PackageOpen size={20} /> },
  { href: "/collector/deliveries", label: "Deliveries", icon: <Truck size={20} /> },
  { href: "/collector/feedback", label: "Field report", icon: <MessageSquareWarning size={20} /> },
  { href: "/collector/history", label: "History", icon: <History size={20} /> },
];

export default function CollectorLayout({ children }: { children: React.ReactNode }) {
  const open = usePathname() === "/collector/login";
  const user = useRequireAuth(["collector", "admin"], "/collector/login", !open);
  const CURRENT_COLLECTOR = useCollector();
  if (open) {
    return <>{children}</>;
  }
  if (!user) return null; // checking the session, or on the way to the login page
  return (
    <Shell nav={NAV} user={{ name: CURRENT_COLLECTOR.name, email: CURRENT_COLLECTOR.org, role: "Collector portal" }}>
      {children}
    </Shell>
  );
}
