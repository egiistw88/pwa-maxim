"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type DialogProps = {
  open: boolean;
  title?: string;
  onClose?: () => void;
  dismissible?: boolean;
  children: React.ReactNode;
};

export function Dialog({
  open,
  onClose,
  title,
  dismissible = true,
  children
}: DialogProps) {
  const [mounted, setMounted] = useState(false);
  const canDismiss = dismissible !== false && !!onClose;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && canDismiss && onClose) {
        onClose();
      }
    }
    if (open) {
      window.addEventListener("keydown", onKeyDown);
    }
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, canDismiss]);

  if (!mounted || !open) {
    return null;
  }

  return createPortal(
    <div className="dialog-backdrop" onClick={canDismiss ? onClose : undefined}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        {(title || onClose) && (
          <div className="dialog-header">
            {title ? <strong>{title}</strong> : <span />}
            {onClose ? (
              <button
                type="button"
                className="ghost"
                onClick={onClose}
                aria-label="Close dialog"
              >
                ✕
              </button>
            ) : null}
          </div>
        )}
        <div className="dialog-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}
