"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OfferReadObservation } from "@/lib/offer-read-version";
import { supabase } from "@/lib/supabase/client";
import { captureNotificationSnapshot, confirmNotificationRead, confirmOfferRead, displayedNotificationIds,
  type NotificationSnapshot, type ReadContext, type ReadRole } from "@/lib/notification-read-receipts";

// One immutable observation batch per page/account. Realtime refreshes may show
// new information but do not silently add later notifications to this batch.
export function useVisibleNotificationRead(role: ReadRole, types: readonly string[]) {
  const [snapshot, setSnapshot] = useState<NotificationSnapshot | null>(null);
  const [offerReadUnavailable, setOfferReadUnavailable] = useState(false);
  const cleanups = useRef(new Set<() => void>());
  const state = useRef<{ userId: string | null; pending?: Promise<void>; offerAttempts: Set<string>; attempted: Set<string>; generation: number; snapshot?: NotificationSnapshot }>({ userId: null, offerAttempts: new Set(), attempted: new Set(), generation: 0 });
  const typesRef = useRef(types);
  useEffect(() => { typesRef.current = types; }, [types]);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (state.current.userId && state.current.userId !== session?.user.id) {
        cleanups.current.forEach(cleanup => cleanup());
        state.current = { userId: null, offerAttempts: new Set(), attempted: new Set(), generation: state.current.generation + 1 };
        setSnapshot(null);
      }
    });
    const observers = cleanups.current;
    return () => {
      observers.forEach(cleanup => cleanup());
      state.current = { userId: null, offerAttempts: new Set(), attempted: new Set(), generation: state.current.generation + 1 };
      data.subscription.unsubscribe();
    };
  }, [role]);
  const capture = useCallback(async (userId: string) => {
    if (state.current.userId === userId && state.current.pending) return state.current.pending;
    cleanups.current.forEach(cleanup => cleanup());
    setOfferReadUnavailable(false);
    const generation = state.current.generation + 1;
    state.current = { userId, offerAttempts: new Set(), attempted: new Set(), generation };
    setSnapshot(null);
    const pending = captureNotificationSnapshot(userId, role).then(result => {
      if (state.current.generation === generation) state.current.snapshot = result;
    }).catch(() => { /* No receipt on failure; loading the page remains independent. */ });
    state.current.pending = pending;
    return pending;
  }, [role]);
  const complete = useCallback((userId: string) => {
    if (state.current.userId === userId && state.current.snapshot) setSnapshot(state.current.snapshot);
  }, []);
  const observe = useCallback((context: ReadContext, observation?: OfferReadObservation | null) => (element: HTMLElement | null) => {
    if (!element || !snapshot || snapshot.role !== role || snapshot.userId !== state.current.userId || !globalThis.IntersectionObserver) return;
    const focus = new URLSearchParams(window.location.search);
    if (focus.has("focusOffer") && focus.get("focusOffer") !== context.offerId) return;
    if (!focus.has("focusOffer") && focus.has("focusRequest") && focus.get("focusRequest") !== context.requestId) return;
    const key = `${context.requestId}:${context.offerId ?? ""}:${context.appointmentId ?? ""}`;
    const offerKey = observation ? JSON.stringify([observation.userId, observation.role, observation.offerId, observation.version]) : null;
    const eligible = !!observation && observation.userId === snapshot.userId && observation.role === role && observation.offerId === context.offerId;
    if (state.current.attempted.has(key) && (!eligible || (offerKey && state.current.offerAttempts.has(offerKey)))) return;
    const generation = state.current.generation;
    const controller = new AbortController();
    let disposed = false;
    const visible = () => !disposed && element.isConnected && document.visibilityState === "visible";
    const isCurrent = () => generation === state.current.generation && snapshot.userId === state.current.userId && visible();
    let intersecting = false;
    const acknowledge = () => {
      if (!intersecting || !isCurrent()) return;
      const markNotifications = !state.current.attempted.has(key);
      state.current.attempted.add(key);
      observer.disconnect();
      document.removeEventListener("visibilitychange", acknowledge);
      const ids = displayedNotificationIds(snapshot, context, typesRef.current);
      void (async () => {
        try {
          const confirmed = markNotifications ? await confirmNotificationRead(snapshot, ids) : [];
          if (generation !== state.current.generation) return;
          if (confirmed.length) window.dispatchEvent(new Event("notifications-read-updated"));
        } catch { /* Never clear a badge optimistically. */ }
        if (!isCurrent()) return;
        if (observation === null) setOfferReadUnavailable(true);
        if (eligible && observation && offerKey && !state.current.offerAttempts.has(offerKey)) {
          state.current.offerAttempts.add(offerKey);
          try {
            const result = await confirmOfferRead(role, snapshot.userId, [observation], { signal: controller.signal, isCurrent });
            if (isCurrent()) setOfferReadUnavailable(false);
            if (isCurrent() && result.confirmedIds.length) window.dispatchEvent(new Event("offers-read-updated"));
          } catch (error) {
            if (isCurrent() && error instanceof Error && error.message === "OFFER_READ_UNAVAILABLE") setOfferReadUnavailable(true);
            // No retry and no optimistic receipt on errors or cancellation.
          }
        }
      })();
    };
    const observer = new IntersectionObserver(entries => {
      intersecting = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.01);
      acknowledge();
    }, { threshold: 0.01 });
    document.addEventListener("visibilitychange", acknowledge);
    observer.observe(element);
    const cleanup = () => {
      disposed = true;
      controller.abort();
      observer.disconnect();
      document.removeEventListener("visibilitychange", acknowledge);
      cleanups.current.delete(cleanup);
    };
    cleanups.current.add(cleanup);
    return cleanup;
  }, [role, snapshot]);
  return { capture, complete, observe, offerReadUnavailable };
}
