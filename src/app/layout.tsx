import type { Metadata } from "next";
import localFont from "next/font/local";
import { Great_Vibes, Instrument_Serif } from "next/font/google";
import "./globals.css";
import AdTag from "@/components/AdTag";
import ErrorReporter from "@/components/ErrorReporter";

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
const display = Instrument_Serif({ subsets: ["latin"], weight: "400", variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://gettarget.vercel.app"),
  title: "TARGET",
  description: "TARGET: your personal AI that gets things done.",
  openGraph: {
    title: "TARGET: Ask anything",
    description: "Your personal AI that plans, researches and organizes, and asks before it acts.",
    url: "https://gettarget.vercel.app",
    siteName: "TARGET",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "TARGET: Ask anything", description: "Your personal AI that gets things done." },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <head>
        <link rel="preload" as="image" href="/water-poster.webp" type="image/webp" />
        <AdTag />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${script.variable} ${display.variable} antialiased`}
      >
        {children}
        <ErrorReporter />
      </body>
    </html>
  );
}
