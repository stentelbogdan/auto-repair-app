"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import RepairRequestCard from "@/app/components/RepairRequestCard";

type MyRequestsTab = "waiting" | "with_offer" | "archive";

export default function MyRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MyRequestsTab>("waiting");
  const [debugUser, setDebugUser] = useState<{
    id: string;
    email: string | null;
    requestCount: number;
  } | null>(null);

  useEffect(() => {
    const savedTab = sessionStorage.getItem("my-requests-active-tab");

    if (
      savedTab === "waiting" ||
      savedTab === "with_offer" ||
      savedTab === "archive"
    ) {
      setActiveTab(savedTab);
    }
  }, []);

  useEffect(() => {
    const loadRequests = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const data = await getOwnRepairRequests(authData.user.id);

        setDebugUser({
          id: authData.user.id,
          email: authData.user.email ?? null,
          requestCount: data.length,
        });

        setRequests(data);

        const requestIds = data.map((request) => request.id);

        if (requestIds.length > 0) {
          const { data: offersData } = await supabase
            .from("repair_offers")
            .select("request_id")
            .in("request_id", requestIds);

          const counts: Record<string, number> = {};

          offersData?.forEach((offer) => {
            counts[offer.request_id] = (counts[offer.request_id] || 0) + 1;
          });

          setOfferCounts(counts);
        }
      } catch (error) {
        console.error("Failed to load requests:", error);
        alert("Nu am putut încărca daunele tale.");
      } finally {
        setLoading(false);
      }
    };

    loadRequests();
  }, [router]);

  const waitingRequests = requests.filter((request) => {
    const count = offerCounts[request.id] || 0;

    return (
      request.status === "open" && !request.accepted_offer_id && count === 0
    );
  });

  const withOfferRequests = requests.filter((request) => {
    const count = offerCounts[request.id] || 0;

    return request.status === "open" && !request.accepted_offer_id && count > 0;
  });

  const archiveRequests = requests.filter((request) => {
    return request.status !== "open" || Boolean(request.accepted_offer_id);
  });

  const visibleRequests =
    activeTab === "waiting"
      ? waitingRequests
      : activeTab === "with_offer"
        ? withOfferRequests
        : archiveRequests;

  const changeTab = (tab: MyRequestsTab) => {
    setActiveTab(tab);
    sessionStorage.setItem("my-requests-active-tab", tab);
  };

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        {debugUser && (
          <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-white">
            <p>
              <strong>Cont:</strong> {debugUser.email || "fără email"}
            </p>

            <p className="mt-1 break-all">
              <strong>User ID:</strong> {debugUser.id}
            </p>

            <p className="mt-1">
              <strong>Cereri returnate:</strong> {debugUser.requestCount}
            </p>
          </div>
        )}

        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>
            <h1 className="mt-1 text-2xl font-bold">Cererile mele</h1>
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
            onClick={() => changeTab("waiting")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "waiting"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            În așteptare ({waitingRequests.length})
          </button>

          <button
            onClick={() => changeTab("with_offer")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "with_offer"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Cu ofertă ({withOfferRequests.length})
          </button>

          <button
            onClick={() => changeTab("archive")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "archive"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Istoric ({archiveRequests.length})
          </button>
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă cererile...</p>
        ) : visibleRequests.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">
              {activeTab === "waiting"
                ? "Nu ai cereri în așteptare"
                : activeTab === "with_offer"
                  ? "Nu ai cereri cu ofertă"
                  : "Nu ai cereri în istoric"}
            </h2>

            <p className="mt-2 text-sm text-black/60">
              {activeTab === "archive"
                ? "Cererile programate, în lucru sau finalizate vor apărea aici."
                : "Postează o daună ca să primești oferte de la service-uri."}
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
              <RepairRequestCard
                key={request.id}
                request={request}
                onEdit={() =>
                  router.push(`/customer/my-requests/${request.id}`)
                }
                onView={() => {
                  if (activeTab === "with_offer") {
                    router.push("/offers");
                    return;
                  }

                  router.push(`/customer/my-requests/${request.id}`);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
