import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vendor Risk Snapshot: free third-party security check",
  description:
    "Check any supplier's public security posture in seconds: ransomware leak-site listings, breach history, known-exploited vulnerabilities and email spoofing protection. Free, passive, no signup.",
  openGraph: {
    title: "Vendor Risk Snapshot",
    description: "Is your vendor a security risk? A free, passive check from open threat-intelligence sources.",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
