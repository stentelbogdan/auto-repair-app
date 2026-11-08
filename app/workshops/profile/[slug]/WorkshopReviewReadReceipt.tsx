"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-provider";
import { useVisibleNotificationRead } from "@/lib/hooks/useVisibleNotificationRead";
import { CUSTOMER_REVIEW_SUBMITTED_NOTIFICATION_TYPE } from "@/lib/notifications";
import { supabase } from "@/lib/supabase/client";
import { getOwnProfile } from "@/lib/supabase/profiles";

type Observe = ReturnType<typeof useVisibleNotificationRead>["observe"];
const ReviewReadContext = createContext<Observe | null>(null);
const reviewTypes = [CUSTOMER_REVIEW_SUBMITTED_NOTIFICATION_TYPE];

function OwnWorkshopReviewReads({ userId, children }: { userId: string; children: ReactNode }) {
  const { capture, complete, observe } = useVisibleNotificationRead("workshop", reviewTypes);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data: profile, error } = await getOwnProfile(supabase);
        if (cancelled || error || profile?.id !== userId || !profile.role?.includes("workshop")) return;
        // A single immutable batch for the rendered reviews, not all later arrivals.
        await capture(userId);
        if (!cancelled) complete(userId);
      } catch {
        // Public reviews remain readable; failed confirmation never clears a badge.
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [userId, capture, complete]);

  return <ReviewReadContext.Provider value={observe}>{children}</ReviewReadContext.Provider>;
}

export function WorkshopReviewReadBoundary({ workshopId, children }: { workshopId: string; children: ReactNode }) {
  const { user, loading } = useAuth();
  // This is a public page. Only its authenticated Service owner can acknowledge.
  if (loading || !user || user.id !== workshopId) return <>{children}</>;
  return <OwnWorkshopReviewReads key={user.id} userId={user.id}>{children}</OwnWorkshopReviewReads>;
}

export function WorkshopReviewReadCard({ reviewId, requestId, offerId, children }: {
  reviewId: string;
  requestId: string;
  offerId: string | null;
  children: ReactNode;
}) {
  const observe = useContext(ReviewReadContext);
  // Stable ref: gallery state/rerenders must not cancel the same visible receipt.
  // No offer observation is supplied: this acknowledges review notifications only.
  const ref = useMemo(() => observe?.({ requestId, offerId: offerId ?? undefined }),
    [observe, requestId, offerId]);
  return <div ref={ref} data-review-id={reviewId}
    className="w-full max-w-full overflow-hidden rounded-3xl bg-white p-5 text-black">
    {children}
  </div>;
}
