"use client";

import { getAffectedPartLabels, getDamageTypeLabels } from "@/lib/car-damage";
import CarHeader from "@/app/components/CarHeader";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";
import { getRequestTypeBadgeLabel } from "@/lib/displayLabels";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import {
  formatProgressStatus,
  normalizeProgressStatus,
} from "@/lib/work-progress/workflows";

type RepairRequestCardProps = {
  request: RepairRequestRow;
  variant?: "customer" | "workshop";
  dark?: boolean;
  actionLabel?: string;
  onAction?: () => void;
  onEdit?: () => void;
  onView?: () => void;
  categoryLabel?: string;
  categoryIcon?: string;
  postedAt?: string;
  showScheduledBadge?: boolean;
};

export default function RepairRequestCard({
  request,
  variant = "customer",
  dark = false,
  actionLabel,
  onAction,
  onEdit,
  onView,
  categoryLabel,
  categoryIcon,
  postedAt,
  showScheduledBadge = false,
}: RepairRequestCardProps) {
  const isOpen = request.status === "open" && !request.accepted_offer_id;
  const isWorkshop = variant === "workshop";

  const affectedPartLabels = getAffectedPartLabels(request.service_details);

  const damageTypeLabels = getDamageTypeLabels(request.service_details);

  const mechanicalDetails =
    request.service_type === "mechanical"
      ? getMechanicalServiceDetailGroups(request.service_details)
      : [];

  const cardClassName = dark
    ? "w-full overflow-hidden rounded-[22px] border border-white/10 bg-white/5 text-left text-white shadow-lg"
    : "w-full overflow-hidden rounded-[22px] bg-white text-left text-black shadow-lg";

  const descriptionBoxClassName = dark
    ? "mt-4 rounded-2xl border border-white/10 bg-white/5 p-3"
    : "mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3";

  const descriptionTitleClassName = dark
    ? "mb-2 text-[13px] font-semibold leading-[18px] text-white/60"
    : "mb-2 text-[13px] font-semibold leading-[18px] text-black/60";

  const descriptionTextClassName = dark
    ? "text-[15px] leading-6 text-white/75"
    : "text-[15px] leading-6 text-black/70";

  return (
    <div className={cardClassName}>
      <div className="p-4">
        <div>
          <CarHeader
            images={request.images}
            plate={request.license_plate}
            brand={request.car_brand}
            model={request.car_model}
            year={request.car_year}
            city={request.city}
            variant="listLarge"
            platePosition="bottom"
            affectedParts={affectedPartLabels}
            damageTypes={damageTypeLabels}
            mechanicalDetails={mechanicalDetails}
            details={[
              {
                text: formatStatus(request.status, request.accepted_offer_id),
                color:
                  request.status === "completed"
                    ? "green"
                    : request.status === "closed"
                      ? "red"
                      : request.status === "in_progress"
                        ? "orange"
                        : request.accepted_offer_id ||
                            request.status === "matched"
                          ? "blue"
                          : "orange",
              },

              {
                text: getRequestTypeBadgeLabel(request.service_type),
                color: "orange",
              },

              ...(isOpen && (request.offers_count ?? 0) > 0
                ? [
                    {
                      text: `${request.offers_count} ${
                        request.offers_count === 1
                          ? "ofertă primită"
                          : "oferte primite"
                      }`,
                      color: "blue" as const,
                    },
                  ]
                : []),

              ...(showScheduledBadge
                ? [{ text: "Programată", color: "blue" as const }]
                : []),
            ]}
          />

          {isWorkshop && postedAt && (
            <p className="mt-2 text-[13px] font-semibold leading-[18px] text-white/60">
              {postedAt}
            </p>
          )}
        </div>

        {categoryLabel && (
          <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-orange-500/10 px-3 py-1 text-xs font-bold text-orange-400">
            <span>{categoryIcon || "🔧"}</span>
            <span>{categoryLabel}</span>
          </div>
        )}

        <div className={descriptionBoxClassName}>
          <p className={descriptionTitleClassName}>📝 Descriere</p>

          <p className={descriptionTextClassName}>
            {request.description || "Nu ai adăugat descriere."}
          </p>
        </div>

        <button
          type="button"
          onClick={onAction || (isOpen ? onEdit : onView)}
          className="mt-4 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
        >
          {actionLabel || (isOpen ? "✏️ Editează detalii" : "Vezi lucrarea")}
        </button>
      </div>
    </div>
  );
}

function formatStatus(status?: string | null, acceptedOfferId?: string | null) {
  if (acceptedOfferId) return "Service selectat";

  if (normalizeProgressStatus(status)) {
    return formatProgressStatus(status);
  }

  switch (status) {
    case "open":
      return "Deschisă";
    case "matched":
      return "Service selectat";
    case "in_progress":
      return "În lucru";
    case "completed":
      return "Finalizată";
    case "closed":
      return "Închisă";
    default:
      return status || "-";
  }
}
