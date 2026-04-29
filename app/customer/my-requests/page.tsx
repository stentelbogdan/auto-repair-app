"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";

export default function MyRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [loading, setLoading] = useState(true);

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
            onClick={() => router.push("/post-job")}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            + Postează
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă daunele...</p>
        ) : requests.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai daune postate</h2>
            <p className="mt-2 text-sm text-black/60">
              Postează prima daună ca să primești oferte de la service-uri.
            </p>

            <button
              onClick={() => router.push("/post-job")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Postează daună
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <div
                key={request.id}
                className="w-full overflow-hidden rounded-[22px] bg-white text-left text-black shadow-lg"
            >
                <div className="flex gap-4 p-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/10">
                    {request.images?.[0]?.thumbUrl ||
                    request.images?.[0]?.url ||
                    request.images?.[0]?.dataUrl ? (
                        <img
                            src={
                                request.images[0].thumbUrl ||
                                request.images[0].url ||
                                request.images[0].dataUrl ||
                                ""
                            }
                            alt={`${request.car_brand} ${request.car_model}`}
                            className="h-full w-full object-cover border-4 border-red-500"
                        />
                    ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
                            Fără poză
                        </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
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
                        {formatStatus(request.status)}
                      </span>
                    </div>

                    <p className="mt-3 line-clamp-2 text-sm text-black/65">
                      {request.description || "Nu ai adăugat descriere."}
                    </p>
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

function formatStatus(status: string) {
  switch (status) {
    case "open":
      return "Deschisă";
    case "matched":
      return "Programată";
    default:
      return status || "-";
  }
}