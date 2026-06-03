import type { Metadata } from "next/dist/types";
// @ts-ignore — font types vary across Next versions
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chaz — Chess Analysis",
  description: "Local chess analysis tool powered by Stockfish 18",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-screen overflow-hidden antialiased`}
    >
      <body className="h-screen overflow-hidden">{children}</body>
    </html>
  );
}
