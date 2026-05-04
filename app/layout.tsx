import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppNavbar from "./components/AppNavbar";
import { AuthProvider } from "@/lib/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AutoRepair Marketplace",
  description: "Auto repair marketplace app",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="ro"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-black text-white overflow-hidden">
        <AuthProvider>
          <AppNavbar />
          <main className="h-full overflow-y-auto">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
