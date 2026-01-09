import "../styles/globals.css";
import { Nav } from "../components/Nav";

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
        <main>
          <div className="container">{children}</div>
        </main>
      </body>
    </html>
  );
}
