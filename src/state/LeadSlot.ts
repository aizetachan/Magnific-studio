import { createContext } from "react";

/**
 * DOM node in the page "lead" row (to the right of the page description) that a
 * page can portal page-specific controls into — e.g. the Idea/Casting tabs in
 * Historia. Null until the layout mounts the slot.
 */
export const LeadSlotContext = createContext<HTMLElement | null>(null);
