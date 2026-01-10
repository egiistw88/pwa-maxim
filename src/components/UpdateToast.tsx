"use client";

import { useEffect, useState } from "react";

const UPDATE_EVENT = "sw:update";

export function UpdateToast() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<ServiceWorkerRegistration>;
      setRegistration(customEvent.detail);
    };

    window.addEventListener(UPDATE_EVENT, handler);
    return () => {
      window.removeEventListener(UPDATE_EVENT, handler);
    };
  }, []);

  if (!registration) {
    return null;
  }

  return (
    <div className="update-toast">
      <span>Update tersedia.</span>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Muat ulang
      </button>
    </div>
  );
}
