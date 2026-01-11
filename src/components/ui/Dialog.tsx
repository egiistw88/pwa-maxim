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
  const [shouldRender, setShouldRender] = useState(open);
  const [isExiting, setIsExiting] = useState(false);
  const canDismiss = dismissible !== false && !!onClose;

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
      if (event.key === "Escape" && canDismiss && onClose) {
        onClose();
      }
    }
    if (open) {
      window.addEventListener("keydown", onKeyDown);
    }
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, canDismiss]);

  if (!mounted || !shouldRender) {
    return null;
  }

  return createPortal(
    <div className={isExiting ? "dialog-exit" : ""}>
      <div className="dialog-backdrop" onClick={canDismiss ? onClose : undefined}>
        <div
          className="dialog dialog-panel"
          onClick={(event) => event.stopPropagation()}
        >
          {(title || onClose) && (
            <div className="dialog-header">
              {title ? <strong>{title}</strong> : <span />}
              {onClose ? (
                <button
                  type="button"
                  className="btn ghost"
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
      </div>
    </div>,
    document.body
  );
}
