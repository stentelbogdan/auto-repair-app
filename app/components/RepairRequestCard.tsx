"use client";

import CarHeader from "@/app/components/CarHeader";
import type { RepairRequestRow } from "@/lib/supabase/repair-requests";

type RepairRequestCardProps = {
  request: RepairRequestRow;
  activeTab?: string;
  onEdit?: () => void;
  onView?: () => void;
};

export default function RepairRequestCard({
  request,
  onEdit,
  onView,
}: RepairRequestCardProps) {
  const isOpen = request.status === "open" && !request.accepted_offer_id;

  return (
    <div className="w-full overflow-hidden rounded-[22px] bg-white text-left text-black shadow-lg">
      <div className="flex gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <CarHeader
              images={request.images}
              plate={request.license_plate}
              brand={request.car_brand}
              model={request.car_model}
              year={request.car_year}
              city={request.city}
              variant="listLarge"
            />

            <div className="shrink-0 mr-2 flex flex-col items-end gap-1">
              {request.accepted_offer_id || request.status === "matched" ? (
                <>
                  <div className="-ml-2 flex h-11 w-[78px] flex-col items-center justify-center rounded-xl bg-orange-100 text-center text-orange-700 ring-1 ring-orange-200">
                    <span className="text-[9px] font-extrabold uppercase tracking-[0.08em] leading-none">
                      Service
                    </span>

                    <span className="mt-0.5 text-[10px] font-semibold leading-none">
                      selectat
                    </span>
                  </div>

                  <span className="-ml-4 flex w-[90px] items-center justify-center rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">
                    <span className="flex items-center gap-1">
                      <span>📅</span>
                      <span>Programată</span>
                    </span>
                  </span>
                </>
              ) : (
                <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                  {formatStatus(request.status, request.accepted_offer_id)}
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
            <p className="mb-2 text-xs font-semibold text-black/45">
              📝 Descriere
            </p>

            <p className="text-sm leading-6 text-black/70">
              {request.description || "Nu ai adăugat descriere."}
            </p>
          </div>

          {isOpen ? (
            <button
              type="button"
              onClick={onEdit}
              className="mt-4 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
            >
              ✏️ Editează detalii
            </button>
          ) : (
            <button
              type="button"
              onClick={onView}
              className="mt-4 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-bold text-white transition hover:bg-orange-600"
            >
              Vezi lucrarea
            </button>
          )}

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
        </div>
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
