import type { Metadata } from "next";
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
  title: "ARB//RADAR V3.2 — Histórico + Cerebro Táctico + IOL L2",
  description: "Dashboard de arbitraje de LECAPs y BONCAPs con datos en tiempo real. V3.2 — Módulo de Acumulación Histórica + Cerebro Táctico + IOL Level 2 + Filtro de Verdad.",
  keywords: ["arbitraje", "LECAP", "BONCAP", "Argentina", "tasas", "curvas", "dólar MEP", "CCL", "spread caución", "duration modified"],
  authors: [{ name: "ARB Radar" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "ARB//RADAR V3.2",
    description: "Dashboard de arbitraje argentino — LECAPs, BONCAPs, curvas, dólar — V3.2",
    url: "https://arbradar.com",
    siteName: "ARB Radar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ARB//RADAR V3.2",
    description: "Dashboard de arbitraje argentino — LECAPs, BONCAPs, curvas, dólar — V3.2",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
