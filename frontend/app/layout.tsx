import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { WalletButton } from "@/components/WalletButton";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AegisX",
  description: "AI-powered programmable security layer for Avalanche wallets.",
};

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 1L18 5V11C18 15.5 14.5 18.5 10 19C5.5 18.5 2 15.5 2 11V5L10 1Z"
        stroke="var(--signal-mint)"
        strokeWidth="1.4"
      />
      <path d="M10 5.5L14 7.6V11C14 13.4 12.3 15.1 10 15.6C7.7 15.1 6 13.4 6 11V7.6L10 5.5Z" fill="var(--signal-mint)" fillOpacity="0.25" />
    </svg>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${jetbrainsMono.variable}`}>
      <body>
        <div className="topbar">
          <Link href="/" className="brand">
            <BrandMark />
            AEGISX
          </Link>
          <nav className="nav">
            <Link href="/">Console</Link>
            <Link href="/scan">Scan</Link>
            <Link href="/contracts">Contracts</Link>
            <Link href="/alerts">Alerts</Link>
          </nav>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}><span className="chain-pill">FUJI · 43113</span><WalletButton /></div>
        </div>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
