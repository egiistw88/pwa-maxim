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
  const [shouldRender, setShouldRender] = useState(open);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

  if (!mounted || !shouldRender) {
    return null;
  }

  return createPortal(
    <div className={isExiting ? "sheet-exit" : ""}>
      <div className="sheet-backdrop" onClick={onClose}>
        <div
          className="sheet sheet-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="sheet-handle" />
          <div className="sheet-header">
            {title ? <strong>{title}</strong> : <span />}
            <button type="button" className="btn ghost" onClick={onClose}>
              Tutup
            </button>
          </div>
          <div className="sheet-body">{children}</div>
        </div>
      </div>
    </div>,
    document.body
  );
}
