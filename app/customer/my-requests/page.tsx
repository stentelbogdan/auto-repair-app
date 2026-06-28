"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import ImageGallery from "@/app/components/ImageGallery";

export default function MyRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "open" | "scheduled" | "completed" | "closed"
  >("open");

  useEffect(() => {
    const loadRequests = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const data = await getOwnRepairRequests(authData.user.id);

        setRequests(data);
      } catch (error) {
        console.error("Failed to load requests:", error);
        alert("Nu am putut încărca daunele tale.");
      } finally {
        setLoading(false);
      }
    };

    loadRequests();
  }, [router]);

  const openRequests = requests.filter(
    (request) => request.status === "open" && !request.accepted_offer_id,
  );

  const completedRequests = requests.filter(
    (request) => request.status === "completed",
  );

  const closedRequests = requests.filter(
    (request) => request.status === "closed",
  );

  const scheduledRequests = requests.filter(
    (request) =>
      request.status !== "completed" &&
      request.status !== "closed" &&
      (request.accepted_offer_id ||
        [
          "matched",
          "in_progress",
          "Received",
          "Diagnosis",
          "Parts ordered",
          "In repair",
          "Testing",
          "Ready",
        ].includes(request.status)),
  );

  const visibleRequests =
    activeTab === "open"
      ? openRequests
      : activeTab === "scheduled"
        ? scheduledRequests
        : activeTab === "completed"
          ? completedRequests
          : closedRequests;

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>
            <h1 className="mt-1 text-2xl font-bold">Daunele mele</h1>
          </div>

          <button
            onClick={() => router.push("/post-choice")}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            + Postează
          </button>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab("open")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "open"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Deschise ({openRequests.length})
          </button>

          <button
            onClick={() => setActiveTab("scheduled")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "scheduled"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Programate ({scheduledRequests.length})
          </button>

          <button
            onClick={() => setActiveTab("completed")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "completed"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Finalizate ({completedRequests.length})
          </button>

          <button
            onClick={() => setActiveTab("closed")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "closed"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Închise ({closedRequests.length})
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă daunele...</p>
        ) : visibleRequests.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai daune postate</h2>
            <p className="mt-2 text-sm text-black/60">
              Postează prima daună ca să primești oferte de la service-uri.
            </p>

            <button
              onClick={() => router.push("/post-choice")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Postează daună
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleRequests.map((request) => (
              <div
                key={request.id}
                className="w-full overflow-hidden rounded-[22px] bg-white text-left text-black shadow-lg"
              >
                <div className="flex gap-4 p-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/10">
                    {request.images && request.images.length > 0 ? (
                      <ImageGallery
                        images={request.images}
                        alt={`${request.car_brand} ${request.car_model}`}
                        className="h-20 w-20 object-cover"
                        wrapperClassName="block h-20 w-20 overflow-hidden rounded-2xl"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
                        Fără poză
                      </div>
                    )}
                  </div>

                  <div
                    onClick={() =>
                      router.push(`/customer/my-requests/${request.id}`)
                    }
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h2 className="font-bold leading-tight">
                          {request.car_brand} {request.car_model}
                        </h2>
                        <p className="mt-1 text-xs text-black/55">
                          {request.car_year} • {request.city}
                        </p>
                      </div>

                      <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                        {formatStatus(
                          request.status,
                          request.accepted_offer_id,
                        )}
                      </span>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm text-black/65">
                      {request.description || "Nu ai adăugat descriere."}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {request.status === "open" &&
                        !request.accepted_offer_id &&
                        (request.offers_count ?? 0) > 0 && (
                          <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700">
                            📨 {request.offers_count} oferte primite
                          </span>
                        )}

                      {request.status === "matched" && (
                        <span>📅 Programată</span>
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
            ))}
          </div>
        )}
      </div>
    </main>
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
