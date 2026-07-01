"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import RepairRequestCard from "@/app/components/RepairRequestCard";

export default function MyRequestsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "open" | "scheduled" | "completed" | "closed"
  >("open");

  useEffect(() => {
    const savedTab = sessionStorage.getItem("my-requests-active-tab");

    if (
      savedTab === "open" ||
      savedTab === "scheduled" ||
      savedTab === "completed" ||
      savedTab === "closed"
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

  const changeTab = (tab: "open" | "scheduled" | "completed" | "closed") => {
    setActiveTab(tab);
    sessionStorage.setItem("my-requests-active-tab", tab);
  };

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
            onClick={() => changeTab("open")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "open"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Deschise ({openRequests.length})
          </button>

          <button
            onClick={() => changeTab("scheduled")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "scheduled"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Programate ({scheduledRequests.length})
          </button>

          <button
            onClick={() => changeTab("completed")}
            className={`rounded-full px-4 py-2 text-sm font-bold ${
              activeTab === "completed"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Finalizate ({completedRequests.length})
          </button>

          <button
            onClick={() => changeTab("closed")}
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
              <RepairRequestCard
                key={request.id}
                request={request}
                onEdit={() =>
                  router.push(`/customer/my-requests/${request.id}`)
                }
                onView={() =>
                  router.push(
                    `/customer/my-jobs/${request.id}?from=my-requests&tab=${activeTab}`,
                  )
                }
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
