"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";

export default function MyJobsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [offers, setOffers] = useState<RepairOfferRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadJobs = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const [requestRows, offerRows] = await Promise.all([
          getOwnRepairRequests(authData.user.id),
          getOffersForCustomerRequests(authData.user.id),
        ]);

        setRequests(requestRows);
        setOffers(offerRows);
      } catch (error) {
        console.error("Failed to load jobs:", error);
        alert("Nu am putut încărca programările.");
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, [router]);

  const jobs = useMemo(() => {
    return requests
      .filter((request) => {
        const status = request.status || "";

        return (
          status === "matched" ||
          status === "in_progress" ||
          status === "completed" ||
          Boolean(request.accepted_offer_id)
        );
      })
      .map((request) => {
        const acceptedOffer = offers.find(
          (offer) =>
            offer.id === request.accepted_offer_id ||
            (offer.request_id === request.id && offer.status === "accepted"),
        );

        return {
          request,
          acceptedOffer,
        };
      });
  }, [requests, offers]);

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>
            <h1 className="mt-1 text-2xl font-bold">Programări</h1>
          </div>

          <button
            onClick={() => router.push("/customer/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă programările...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai programări încă</h2>
            <p className="mt-2 text-sm text-black/60">
              Când accepți o ofertă, lucrarea programată va apărea aici.
            </p>

            <button
              onClick={() => router.push("/offers")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Vezi ofertele
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map(({ request, acceptedOffer }) => {
              const image =
                request.images?.[0]?.url || request.images?.[0]?.dataUrl || "";

              return (
                <div
                  key={request.id}
                  onClick={() => router.push(`/customer/my-requests/${request.id}`)}
                  className="overflow-hidden rounded-[26px] bg-white text-black shadow-lg transition active:scale-[0.99]"
                >
                  <div className="flex gap-4 p-4">
                    <div className="h-24 w-24 shrink-0 overflow-hidden rounded-3xl bg-black/10">
                      {image ? (
                        <img
                          src={image}
                          alt={`${request.car_brand} ${request.car_model}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-black/40">
                          No photo
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h2 className="text-xl font-black leading-tight">
                            {request.car_brand} {request.car_model}
                          </h2>
                          <p className="mt-1 text-sm text-black/55">
                            {request.car_year} • {request.city}
                          </p>
                        </div>

                        <span
                          className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${getStatusClass(
                            request.status,
                          )}`}
                        >
                          {formatJobStatus(request.status)}
                        </span>
                      </div>

                      {acceptedOffer && (
                        <div className="mt-3 rounded-2xl bg-black/[0.04] p-3">
                          <p className="text-xs text-black/45">Service</p>
                          <p className="font-semibold">
                            {acceptedOffer.workshop_name}
                          </p>

                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-black/55">
                              {acceptedOffer.days}{" "}
                              {String(acceptedOffer.days) === "1"
                                ? "zi"
                                : "zile"}
                            </span>
                            <span className="font-bold">
                              €{acceptedOffer.price}
                            </span>
                          </div>
                        </div>
                      )}

                      <p className="mt-3 line-clamp-2 text-sm text-black/65">
                        {request.description || "Fără descriere."}
                      </p>

                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/chat/${request.id}`);
                          }}
                          className="rounded-2xl bg-black px-4 py-3 text-sm font-bold text-white"
                        >
                          Chat cu service-ul
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function formatJobStatus(status?: string | null) {
  switch (status) {
    case "in_progress":
      return "În lucru";
    case "completed":
      return "Finalizată";
    case "matched":
      return "Programată";
    default:
      return "Programată";
  }
}

function getStatusClass(status?: string | null) {
  switch (status) {
    case "in_progress":
      return "bg-blue-100 text-blue-700";
    case "completed":
      return "bg-green-100 text-green-700";
    case "matched":
      return "bg-orange-100 text-orange-700";
    default:
      return "bg-orange-100 text-orange-700";
  }
}
