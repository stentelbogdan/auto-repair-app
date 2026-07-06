"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { supabase } from "@/lib/supabase/client";
import { interactiveCard } from "@/lib/ui";

type WorkshopSummaryCardProps = {
  workshopUserId: string;
  workshopName: string;
  workshopLogoUrl?: string | null;
  workshopSlug?: string | null;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
};

export default function WorkshopSummaryCard({
  workshopUserId,
  workshopName,
  workshopLogoUrl,
  workshopSlug,
  onClick,
}: WorkshopSummaryCardProps) {
  const [averageRating, setAverageRating] = useState<number | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [completedJobs, setCompletedJobs] = useState(0);
  const [lastReview, setLastReview] = useState<string | null>(null);
  const [profileLogoUrl, setProfileLogoUrl] = useState<string | null>(null);

  useEffect(() => {
    async function loadWorkshopStats() {
      if (!workshopUserId) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("workshop_logo_url")
        .eq("id", workshopUserId)
        .single();

      setProfileLogoUrl(profileData?.workshop_logo_url || null);

      const { data: reviewsData } = await supabase
        .from("reviews")
        .select("rating, comment, created_at")
        .eq("workshop_user_id", workshopUserId)
        .order("created_at", { ascending: false });

      if (reviewsData && reviewsData.length > 0) {
        const total = reviewsData.reduce(
          (sum, review) => sum + Number(review.rating || 0),
          0,
        );

        setAverageRating(total / reviewsData.length);
        setReviewCount(reviewsData.length);
        setLastReview(reviewsData[0]?.comment || null);
      }

      //   const { count } = await supabase
      //     .from("repair_requests")
      //     .select("id", { count: "exact", head: true })
      //     .eq("assigned_workshop_user_id", workshopUserId)
      //     .eq("status", "completed");

      //   setCompletedJobs(count || 0);
    }

    loadWorkshopStats();
  }, [workshopUserId]);

  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      className={`${interactiveCard} mt-4 rounded-2xl bg-gray-100 p-4`}
    >
      <p className="text-xs text-black/40">Service</p>

      <div className="mt-3 flex items-start gap-4">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm">
          {profileLogoUrl || workshopLogoUrl ? (
            <img
              src={profileLogoUrl || workshopLogoUrl || ""}
              alt={workshopName}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-sm font-black text-black/60">
              AR
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-black text-black underline decoration-orange-300 underline-offset-4">
            {workshopName}
          </p>

          {averageRating !== null && reviewCount > 0 && (
            <div className="mt-1 flex items-center gap-1 text-xs font-bold">
              <span className="text-orange-500">★★★★★</span>
              <span className="text-black/60">
                {averageRating.toFixed(1)} ({reviewCount} review-uri)
              </span>
            </div>
          )}

          {completedJobs > 0 && (
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              ✓ {completedJobs} lucrări finalizate
            </p>
          )}

          <div className="mt-2 text-xs font-medium text-black/80">
            <p>Experiență verificată:</p>
            <p className="mt-0.5">Tinichigerie • Vopsitorie • Polish</p>
          </div>

          {lastReview && (
            <div className="mt-2 rounded-xl bg-white/70 p-2">
              <p className="text-[11px] font-semibold text-black/50">
                💬 Ultimul client
              </p>
              <p className="mt-1 text-sm italic text-black/80">
                “{lastReview}”
              </p>
            </div>
          )}

          {workshopSlug && (
            <p className="mt-3 text-sm font-bold text-black underline underline-offset-4">
              Vezi profilul și review-urile →
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
