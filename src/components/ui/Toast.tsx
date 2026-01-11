"use client";

import { useEffect } from "react";

type ToastProps = {
  open: boolean;
  message: string;
  onClose: () => void;
  durationMs?: number;
};

export function Toast({ open, message, onClose, durationMs = 2400 }: ToastProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      onClose();
    }, durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}
