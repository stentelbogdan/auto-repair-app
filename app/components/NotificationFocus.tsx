"use client";
import { Suspense, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useNotificationFocus, type NotificationFocusOptions, type NotificationFocusTarget } from "@/lib/hooks/useNotificationFocus";

type Props<T extends NotificationFocusTarget> = NotificationFocusOptions<T> & {
  onFocusChange?: (focus: string) => void;
};

function FocusController<T extends NotificationFocusTarget>(props: Props<T>) {
  const search = useSearchParams();
  const focus = JSON.stringify([search.getAll("focusRequest"), search.getAll("focusOffer"), search.getAll("focusAppointment")]);
  const previous = useRef(focus);
  const { onFocusChange } = props;
  useEffect(() => {
    if (previous.current === focus) return;
    previous.current = focus;
    onFocusChange?.(focus);
  }, [focus, onFocusChange]);
  useNotificationFocus(props, search.toString());
  return null;
}

// Query-only navigation on the same page must be observed too. Keep the Suspense
// boundary local so the page can still prerender without fetching or acknowledging.
export default function NotificationFocus<T extends NotificationFocusTarget>(props: Props<T>) {
  return <Suspense fallback={null}><FocusController {...props} /></Suspense>;
}
