"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type PageTransitionProps = {
  children: React.ReactNode;
};

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [isEntering, setIsEntering] = useState(false);
  const [pageKey, setPageKey] = useState(pathname);

  useEffect(() => {
    setPageKey(pathname);
    setIsEntering(true);
    const timer = window.setTimeout(() => {
      setIsEntering(false);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  const isMapPage = pathname.startsWith("/heatmap");

  return (
    <main
      key={pageKey}
      className={`page${isEntering ? " page-enter" : ""}${isMapPage ? " page-map" : ""}`}
    >
      <div className="container">{children}</div>
    </main>
  );
}
