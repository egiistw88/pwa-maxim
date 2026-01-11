"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/heatmap",
    label: "Heatmap",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M4 18c1.5-4 4-6 7-6 3 0 5.5 2 7 6M5 8h14M7 4h10" />
      </svg>
    )
  },
  {
    href: "/drive",
    label: "Drive",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 16l2-6h10l2 6M7 16a2 2 0 104 0M13 16a2 2 0 104 0" />
      </svg>
    )
  },
  {
    href: "/wallet",
    label: "Dompet",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7h16v10H4zM16 12h4" />
      </svg>
    )
  },
  {
    href: "/more",
    label: "More",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12h14M5 6h14M5 18h14" />
      </svg>
    )
  }
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav">
      {tabs.map((tab) => {
        const active = pathname.startsWith(tab.href);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "active" : ""}>
            <span className="nav-icon">{tab.icon}</span>
            <span className="nav-label">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
