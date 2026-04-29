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
  title: "ARB//RADAR V2.0.5 — Fecha Dinámica + Interpolación Caución",
  description: "Dashboard de arbitraje de LECAPs y BONCAPs con datos en tiempo real. Curvas de tasas, spread vs caución, soporte/resistencia y señales compuestas. V2.0.5 — Fecha Dinámica + Interpolación Caución.",
  keywords: ["arbitraje", "LECAP", "BONCAP", "Argentina", "tasas", "curvas", "dólar MEP", "CCL", "spread caución", "duration modified"],
  authors: [{ name: "ARB Radar" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "ARB//RADAR V2.0.5",
    description: "Dashboard de arbitraje argentino — LECAPs, BONCAPs, curvas, dólar",
    url: "https://arbradar.com",
    siteName: "ARB Radar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ARB//RADAR V2.0.5",
    description: "Dashboard de arbitraje argentino — LECAPs, BONCAPs, curvas, dólar",
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
