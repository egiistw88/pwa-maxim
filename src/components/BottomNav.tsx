"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  { href: "/heatmap", label: "Heatmap" },
  { href: "/drive", label: "Drive" },
  { href: "/wallet", label: "Dompet" },
  { href: "/import", label: "Import" }
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""}>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
