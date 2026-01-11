"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    if (open) {
      window.addEventListener("keydown", onKeyDown);
    }
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        {(title || onClose) && (
          <div className="dialog-header">
            <strong>{title}</strong>
            <button type="button" className="ghost" onClick={onClose}>
              Tutup
            </button>
          </div>
        )}
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
