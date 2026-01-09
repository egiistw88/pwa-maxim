import "../styles/globals.css";
import { Nav } from "../components/Nav";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";

export const metadata = {
  title: "PWA Maxim MVP",
  description: "Heatmap & Dompet untuk Bandung"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>
        <Nav />
        <ServiceWorkerRegister />
        <main>
          <div className="container">{children}</div>
        </main>
      </body>
    </html>
  );
}
