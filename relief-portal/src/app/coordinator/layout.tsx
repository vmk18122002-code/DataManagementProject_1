"use client";

import { BellRing, Gauge, Hand, LayoutDashboard, MapPinned, PackageSearch, Route, Shuffle, Users, Warehouse } from "lucide-react";
import { NavItem, Shell } from "@/components/Shell";
import { useRequireAuth } from "@/lib/auth";
import { useApp } from "@/lib/store";

export default function CoordinatorLayout({ children }: { children: React.ReactNode }) {
  const { alerts } = useApp();
  const user = useRequireAuth(["admin"], "/");
  if (!user) return null; // checking the session, or on the way to the login page
  const nav: NavItem[] = [
    { href: "/coordinator", label: "Dashboard", icon: <LayoutDashboard size={20} /> },
    { href: "/coordinator/donations", label: "Donor data", icon: <PackageSearch size={20} /> },
    { href: "/coordinator/limits", label: "Limits", icon: <Gauge size={20} /> },
    { href: "/coordinator/allocation", label: "Resource allocation", icon: <Shuffle size={20} /> },
    { href: "/coordinator/deliveries", label: "Delivery status", icon: <Route size={20} /> },
    { href: "/coordinator/collectors", label: "Collectors", icon: <Users size={20} /> },
    { href: "/coordinator/dropoff", label: "Drop-off points", icon: <Warehouse size={20} /> },
    { href: "/coordinator/disaster", label: "Alerts", icon: <BellRing size={20} />, section: "Disaster",
      badge: alerts.filter((a) => a.status === "New").length },
    { href: "/coordinator/disaster/affected", label: "Affected areas", icon: <MapPinned size={20} /> },
    { href: "/coordinator/disaster/manual", label: "Manual activation", icon: <Hand size={20} /> },
  ];
  return (
    <Shell nav={nav} user={{ name: user.name, email: user.email, role: "Organization portal" }}>
      {children}
    </Shell>
  );
}
