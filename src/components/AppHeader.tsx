"use client";

import { usePathname } from "next/navigation";
import { useNetworkStatus } from "../lib/useNetworkStatus";

const titles: Record<string, string> = {
  "/heatmap": "Heatmap",
  "/drive": "Drive",
  "/wallet": "Dompet",
  "/more": "More",
  "/import": "Import",
  "/session": "Ekspor"
};

export function AppHeader() {
  const pathname = usePathname();
  const { isOnline } = useNetworkStatus();
  const title = Object.entries(titles).find(([path]) => pathname.startsWith(path))?.[1];

  return (
    <header className="app-header">
      <div className="app-header-title">
        <strong>{title ?? "Maxim Copilot"}</strong>
      </div>
      <div className={`status-pill ${isOnline ? "online" : "offline"}`}>
        {isOnline ? "Online" : "Offline"}
      </div>
    </header>
  );
}
