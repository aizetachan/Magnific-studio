import type { ReactNode } from "react";

/**
 * Shared page header — same look as the Studio pages (28px display title). Used
 * by Settings and by every Home sub-page (except the Home dashboard itself).
 * Shows only the page title, with an optional action on the right. No
 * breadcrumb, no subtitle.
 */
export function PageHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page__head">
      <div>
        <h1>{title}</h1>
      </div>
      {action ?? null}
    </header>
  );
}
