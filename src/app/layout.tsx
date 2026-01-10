import "../styles/globals.css";
import type { Metadata, Viewport } from "next";
import { Nav } from "../components/Nav";
import { SessionBar } from "../components/SessionBar";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "PWA Maxim MVP",
  description: "Heatmap & Dompet untuk Bandung",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Maxim Copilot Bandung"
  }
};

export const viewport: Viewport = {
  themeColor: "#0b0f19"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <SessionBar />
        <Nav />
        <main>
          <div className="container">{children}</div>
        </main>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
