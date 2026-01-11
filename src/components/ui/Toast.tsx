"use client";

import { useEffect, useState } from "react";

type ToastProps = {
  open: boolean;
  message: string;
  onClose: () => void;
  durationMs?: number;
  variant?: "success" | "error";
};

export function Toast({
  open,
  message,
  onClose,
  durationMs = 2200,
  variant
}: ToastProps) {
  const [shouldRender, setShouldRender] = useState(open);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      setIsExiting(false);
      return;
    }
    if (!open && shouldRender) {
      setIsExiting(true);
      const timer = window.setTimeout(() => {
        setShouldRender(false);
        setIsExiting(false);
      }, 120);
      return () => window.clearTimeout(timer);
    }
  }, [open, shouldRender]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      onClose();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs, onClose]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      className={`toast${variant ? ` ${variant}` : ""}${isExiting ? " toast-exit" : ""}`}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
