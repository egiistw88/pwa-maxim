import "../styles/globals.css";
import type { Metadata, Viewport } from "next";
import { AppHeader } from "../components/AppHeader";
import { BottomNav } from "../components/BottomNav";
import { PageTransition } from "../components/PageTransition";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "PWA Maxim MVP",
  description: "Heatmap & Dompet untuk Bandung",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Maxim Copilot"
  }
};

export const viewport: Viewport = {
  themeColor: "#ffffff"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <div className="app-shell">
          <AppHeader />
          <PageTransition>{children}</PageTransition>
          <BottomNav />
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
