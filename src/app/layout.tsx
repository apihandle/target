import type { Metadata } from "next";
import localFont from "next/font/local";
import { Great_Vibes, Playfair_Display } from "next/font/google";
import "./globals.css";
import AdTag from "@/components/AdTag";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const script = Great_Vibes({ subsets: ["latin"], weight: "400", variable: "--font-script", display: "swap" });
const display = Playfair_Display({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "TARGET",
  description: "TARGET: your personal AI that gets things done.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <AdTag />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${script.variable} ${display.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
