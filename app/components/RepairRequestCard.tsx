"use client";

import CarHeader from "@/app/components/CarHeader";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

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

  const cardClassName = dark
    ? "w-full overflow-hidden rounded-[22px] border border-white/10 bg-white/5 text-left text-white shadow-lg"
    : "w-full overflow-hidden rounded-[22px] bg-white text-left text-black shadow-lg";

  const descriptionBoxClassName = dark
    ? "mt-4 rounded-2xl border border-white/10 bg-white/5 p-3"
    : "mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3";

  const descriptionTitleClassName = dark
    ? "mb-2 text-xs font-semibold text-white/45"
    : "mb-2 text-xs font-semibold text-black/45";

  const descriptionTextClassName = dark
    ? "text-sm leading-6 text-white/75"
    : "text-sm leading-6 text-black/70";

  return (
    <div className={cardClassName}>
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <CarHeader
            images={request.images}
            plate={request.license_plate}
            brand={request.car_brand}
            model={request.car_model}
            year={request.car_year}
            city={request.city}
            variant="listLarge"
          />

          {isWorkshop ? (
            <div className="flex shrink-0 flex-col items-center">
              <span className="rounded-full bg-yellow-500/15 px-3 py-1 text-xs font-semibold text-yellow-300">
                Deschisă
              </span>

              {postedAt && (
                <span className="mt-1 text-[10px] font-semibold text-white/45">
                  {postedAt}
                </span>
              )}
            </div>
          ) : request.accepted_offer_id || request.status === "matched" ? (
            <div className="shrink-0 mr-4 flex flex-col items-end gap-1">
              <div className="-translate-x-1 flex h-11 w-[78px] flex-col items-center justify-center rounded-xl bg-orange-100 text-center text-orange-700 ring-1 ring-orange-200">
                <span className="text-[9px] font-extrabold uppercase leading-none tracking-[0.08em]">
                  Service
                </span>

                <span className="mt-0.5 text-[10px] font-semibold leading-none">
                  selectat
                </span>
              </div>

              {showScheduledBadge && (
                <span className="-ml-4 flex w-[90px] items-center justify-center rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                  <span className="flex items-center gap-1">
                    <span>📅</span>
                    <span>Programată</span>
                  </span>
                </span>
              )}
            </div>
          ) : (
            <span className="shrink-0 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
              {formatStatus(request.status, request.accepted_offer_id)}
            </span>
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

        {!isWorkshop && (
          <div className="mt-3 flex flex-wrap gap-2">
            {isOpen && (request.offers_count ?? 0) > 0 && (
              <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                📨 {request.offers_count} oferte primite
              </span>
            )}

            {request.status === "in_progress" && (
              <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                🔧 În lucru
              </span>
            )}

            {request.status === "completed" && (
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
                ✅ Finalizată
              </span>
            )}

            {request.status === "closed" && (
              <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                🚫 Închisă
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatStatus(status?: string | null, acceptedOfferId?: string | null) {
  if (acceptedOfferId) return "Service selectat";

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
    case "Received":
      return "Primită";
    case "Diagnosis":
      return "Diagnoză";
    case "Parts ordered":
      return "Piese comandate";
    case "In repair":
      return "În reparație";
    case "Testing":
      return "Testare";
    case "Ready":
      return "Gata";
    default:
      return status || "-";
  }
}
