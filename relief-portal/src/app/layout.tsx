import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import { AuthProvider } from "@/lib/auth";
import { AppStateProvider } from "@/lib/store";
import "./globals.css";

const rubik = Rubik({ variable: "--font-rubik", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ReliefHub",
  description: "Donation, allocation and disaster relief coordination for Sri Lanka",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${rubik.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <AuthProvider><AppStateProvider>{children}</AppStateProvider></AuthProvider>
      </body>
    </html>
  );
}
