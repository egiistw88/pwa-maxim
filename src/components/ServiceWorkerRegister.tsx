"use client";

import { useEffect, useState } from "react";

export function ServiceWorkerRegister() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const handleControllerChange = () => {
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    navigator.serviceWorker
      .register("/sw.js")
      .then((registrationInstance) => {
        if (registrationInstance.waiting) {
          setRegistration(registrationInstance);
        }

        registrationInstance.addEventListener("updatefound", () => {
          const newWorker = registrationInstance.installing;
          if (!newWorker) {
            return;
          }
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              setRegistration(registrationInstance);
            }
          });
        });
      })
      .catch(() => {
        // Optional: swallow registration errors to avoid noisy UI
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
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
        className="btn secondary"
        onClick={() => {
          registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        Reload
      </button>
    </div>
  );
}
