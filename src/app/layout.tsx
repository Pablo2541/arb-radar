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
  title: "Quant-X Dashboard ENGINE V7.0-FASE3-HC",
  description: "Pressure Fallback + Row Flash + Scream Log · Polarity Reversal · Price Action Scanner · El Gatillador Cuantitativo · Dashboard de scalping de LECAPs y BONCAPs con datos en tiempo real. ENGINE V7.0-FASE3-HC",
  keywords: ["arbitraje", "LECAP", "BONCAP", "Argentina", "tasas", "curvas", "dólar MEP", "CCL", "spread caución", "duration modified"],
  authors: [{ name: "ARB Radar" }],
  icons: {
    icon: "/logo.svg",
  },
  openGraph: {
    title: "Quant-X Dashboard ENGINE V7.0-FASE3-HC",
    description: "Pressure Fallback + Row Flash + Scream Log · Polarity Reversal · Price Action Scanner · El Gatillador Cuantitativo — Dashboard de scalping argentino — ENGINE V7.0-FASE3-HC",
    url: "https://arbradar.com",
    siteName: "ARB Radar",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Quant-X Dashboard ENGINE V7.0-FASE3-HC",
    description: "Pressure Fallback + Row Flash + Scream Log · Polarity Reversal · Price Action Scanner · El Gatillador Cuantitativo — Dashboard de scalping argentino — ENGINE V7.0-FASE3-HC",
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
