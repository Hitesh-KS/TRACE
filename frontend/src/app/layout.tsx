import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRACE — Tamper-proof Record Archive for Cryptographic Evidence",
  description:
    "A secure workspace for digital evidence integrity and chain-of-custody records.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
