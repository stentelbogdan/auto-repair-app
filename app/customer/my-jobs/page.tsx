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
        alert("Could not load your jobs.");
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, [router]);

  const jobs = useMemo(() => {
    return requests
      .filter(
        (request) =>
          request.status === "matched" || Boolean(request.accepted_offer_id)
      )
      .map((request) => {
        const acceptedOffer = offers.find(
          (offer) =>
            offer.id === request.accepted_offer_id ||
            (offer.request_id === request.id && offer.status === "accepted")
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
              Customer
            </p>
            <h1 className="mt-1 text-2xl font-bold">My Jobs</h1>
          </div>

          <button
            onClick={() => router.push("/customer/dashboard")}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Loading jobs...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">No booked jobs yet</h2>
            <p className="mt-2 text-sm text-black/60">
              When you accept an offer, the booked repair will appear here.
            </p>

            <button
              onClick={() => router.push("/offers")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              View offers
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map(({ request, acceptedOffer }) => (
              <div
                key={request.id}
                className="overflow-hidden rounded-[22px] bg-white text-black shadow-lg"
              >
                <div className="flex gap-4 p-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-black/10">
                    {request.images?.[0]?.dataUrl ? (
                      <img
                        src={request.images[0].dataUrl}
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
                        <h2 className="font-bold leading-tight">
                          {request.car_brand} {request.car_model}
                        </h2>
                        <p className="mt-1 text-xs text-black/55">
                          {request.car_year} • {request.city}
                        </p>
                      </div>

                      <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                        Booked
                      </span>
                    </div>

                    {acceptedOffer && (
                      <div className="mt-3 rounded-2xl bg-black/[0.04] p-3">
                        <p className="text-xs text-black/45">Workshop</p>
                        <p className="font-semibold">
                          {acceptedOffer.workshop_name}
                        </p>

                        <div className="mt-2 flex items-center justify-between text-sm">
                          <span className="text-black/55">
                            {acceptedOffer.days} day
                            {acceptedOffer.days !== "1" ? "s" : ""}
                          </span>
                          <span className="font-bold">
                            €{acceptedOffer.price}
                          </span>
                        </div>
                      </div>
                    )}

                    <p className="mt-3 line-clamp-2 text-sm text-black/65">
                      {request.description || "No description provided."}
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