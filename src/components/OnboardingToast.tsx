import { useEffect, useState, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

/**
 * First-time onboarding hint, shown as a pink toast that slides in from the
 * top-right (same look as the Director's reply). It appears only ONCE ever
 * (persisted per storageKey) and closes only via the X button.
 */
export function OnboardingToast({
  storageKey,
  children,
}: {
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (!localStorage.getItem(storageKey)) {
        setOpen(true);
        localStorage.setItem(storageKey, "1");
      }
    } catch {
      /* localStorage unavailable — skip the hint */
    }
  }, [storageKey]);

  if (!open) return null;
  return (
    <div className="onboard-toast" role="status">
      <div className="onboard-toast__body">{children}</div>
      <button
        className="onboard-toast__x"
        aria-label="Cerrar"
        onClick={() => setOpen(false)}
      >
        <IconX size={15} />
      </button>
    </div>
  );
}
