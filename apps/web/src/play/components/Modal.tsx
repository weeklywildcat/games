import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { spring } from "../lib/motion.ts";

/**
 * Accessible overlay dialog. Focus moves into the panel, Escape closes it
 * when dismissible, and focus returns to where it was.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  tone = "paper",
  size = "md",
  dismissible = true,
  labelledBy,
}: {
  open: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  tone?: "paper" | "ink";
  size?: "sm" | "md" | "lg";
  dismissible?: boolean;
  labelledBy?: string;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const previous = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    previous.current = document.activeElement;
    const t = window.setTimeout(() => {
      const target = panel.current?.querySelector<HTMLElement>("[data-autofocus], button, [href], [tabindex]:not([tabindex='-1'])");
      (target ?? panel.current)?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) onClose?.();
      if (e.key === "Tab" && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"));
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      (previous.current as HTMLElement | null)?.focus?.({ preventScroll: true });
    };
  }, [open, dismissible, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget && dismissible) onClose?.();
          }}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy ?? (title ? `${id}-title` : undefined)}
            tabIndex={-1}
            className={`modal modal-${tone} modal-${size}`}
            initial={{ opacity: 0, y: 40, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={spring.panel}
          >
            {title ? (
              <h2 className="modal-title display" id={`${id}-title`}>
                {title}
              </h2>
            ) : null}
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
