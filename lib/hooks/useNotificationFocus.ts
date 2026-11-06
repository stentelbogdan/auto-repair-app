"use client";
import { useEffect, useRef } from "react";

export type NotificationFocusTarget = { requestId: string; offerId?: string | null; appointmentId?: string | null; category?: string | null; tab?: string };
export type NotificationFocusOptions<T extends NotificationFocusTarget> = {
  targets: readonly T[];
  ready: boolean;
  // Return true only when the authorized target's real tab/category is rendered.
  select: (target: T) => boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function resolveNotificationFocus<T extends NotificationFocusTarget>(search: string, targets: readonly T[]) {
  const params = new URLSearchParams(search);
  const keys = ["focusRequest", "focusOffer", "focusAppointment"] as const;
  const values = keys.map(key => params.get(key));
  if (!values.some(value => value !== null) || values.some((value, i) =>
    params.getAll(keys[i]).length > 1 || (value !== null && !uuid.test(value)))) return null;
  const [request, offer, appointment] = values;
  const target = targets.find(item => (!request || item.requestId === request) &&
    (!offer || item.offerId === offer) && (!appointment || item.appointmentId === appointment));
  if (!target || !uuid.test(target.requestId)) return null;
  // Always constrain to the authorized request; an offer URL never selects another request.
  const selector = `[data-focus-request="${target.requestId}"]` +
    (offer ? `[data-focus-offer="${offer}"]` : "") +
    (appointment ? `[data-focus-appointment="${appointment}"]` : "");
  return { target, selector, key: JSON.stringify([values, target.tab ?? null, target.category ?? null]) };
}

// No request, read receipt or navigation. Selection comes only from authorized data.
// Query parameters remain available to the visibility/receipt guard throughout refetches.
export function useNotificationFocus<T extends NotificationFocusTarget>(options: NotificationFocusOptions<T>, search: string) {
  const focused = useRef("");
  const highlighted = useRef<HTMLElement | null>(null);
  useEffect(() => () => {
    highlighted.current?.classList.remove("ring-2", "ring-orange-500");
  }, []);
  useEffect(() => {
    // A refetch can temporarily remove the card. Preserve the handled navigation
    // key so the replacement card is highlighted without scrolling again.
    if (!options.ready) {
      highlighted.current?.classList.remove("ring-2", "ring-orange-500");
      highlighted.current = null;
      return;
    }
    const resolved = resolveNotificationFocus(search, options.targets);
    if (!resolved) {
      highlighted.current?.classList.remove("ring-2", "ring-orange-500");
      highlighted.current = null;
      focused.current = "";
      return;
    }
    if (focused.current !== resolved.key && !options.select(resolved.target)) return;
    const element = document.querySelector<HTMLElement>(resolved.selector);
    if (!element || !element.isConnected || element.getClientRects().length === 0) return;
    // Client offers live inside a clipping carousel. Outline its request card,
    // while keeping scrolling and visibility receipts on the exact offer slide.
    const card = element.closest<HTMLElement>(`[data-notification-focus-card="${resolved.target.requestId}"]`) ?? element;
    if (highlighted.current !== card) {
      highlighted.current?.classList.remove("ring-2", "ring-orange-500");
      highlighted.current = card;
    }
    if (focused.current !== resolved.key) {
      element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
      focused.current = resolved.key;
      // Wake visibility guards after query-only navigation too. They still require
      // an intersecting card and matching current IDs; this is not a read receipt.
      document.dispatchEvent(new Event("notification-context-focused"));
    }
    card.classList.add("ring-2", "ring-orange-500");
  });
}
