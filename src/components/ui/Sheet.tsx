"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export function Sheet({ open, onClose, title, children }: SheetProps) {
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-handle" />
        {(title || onClose) && (
          <div className="sheet-header">
            <strong>{title}</strong>
            <button type="button" className="ghost" onClick={onClose}>
              Tutup
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
