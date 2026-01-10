"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/heatmap", label: "Heatmap" },
  { href: "/drive", label: "Drive" },
  { href: "/wallet", label: "Dompet" }
  { href: "/wallet", label: "Dompet" },
  { href: "/session", label: "Sesi" }
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="nav-inner">
        <div>
          <strong>PWA Maxim MVP</strong>
          <div className="helper-text">Bandung Focus</div>
        </div>
        <div className="tabs">
          {tabs.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`tab ${active ? "active" : ""}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
