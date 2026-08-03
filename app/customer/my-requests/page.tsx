"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import RepairRequestCard from "@/app/components/RepairRequestCard";

type MyRequestsTab = "waiting" | "with_offer" | "archive";

export default function MyRequestsPage() {
  /*
   * Acest router rămâne numai pentru redirectul automat
   * de autentificare.
   */
  const router = useRouter();

  /*
   * Navigările pornite prin apăsarea utilizatorului trec
   * prin hook-ul comun.
   */
  const { navigate, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<MyRequestsTab>("waiting");

  /*
   * Restaurăm tabul ales anterior de utilizator.
   */
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

  /*
   * Încărcăm cererile utilizatorului.
   *
   * Variabila cancelled împiedică actualizarea state-ului
   * după ce utilizatorul a părăsit pagina.
   */
  useEffect(() => {
    let cancelled = false;

    const loadRequests = async () => {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (cancelled) {
          return;
        }

        if (authError) {
          throw authError;
        }

        if (!authData.user) {
          /*
           * Redirect automat de autentificare.
           * Nu trece prin useSafeNavigation.
           */
          router.replace("/login");
          return;
        }

        const data = await getOwnRepairRequests(authData.user.id);

        if (cancelled) {
          return;
        }

        setRequests(data);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load requests:", error);
        window.alert("Nu am putut încărca daunele tale.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadRequests();

    return () => {
      cancelled = true;
    };
  }, [router]);

  /*
   * getOwnRepairRequests() calculează deja offers_count.
   * Nu mai executăm încă o interogare separată în această pagină.
   */
  const waitingRequests = requests.filter((request) => {
    const offersCount = request.offers_count ?? 0;

    return (
      request.status === "open" &&
      !request.accepted_offer_id &&
      offersCount === 0
    );
  });

  const withOfferRequests = requests.filter((request) => {
    const offersCount = request.offers_count ?? 0;

    return (
      request.status === "open" && !request.accepted_offer_id && offersCount > 0
    );
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

  const goToPostChoice = () => {
    navigate("/post-choice");
  };

  const goToRequest = (requestId: string) => {
    navigate(`/customer/my-requests/${requestId}`);
  };

  const handleViewRequest = (requestId: string) => {
    if (activeTab === "with_offer") {
      navigate("/offers");
      return;
    }

    navigate(`/customer/my-requests/${requestId}`);
  };

  return (
    <main className="min-h-[calc(100svh-236px)] bg-[#111111] px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
              Client
            </p>

            <h1 className="mt-1 text-2xl font-bold">Cererile mele</h1>
          </div>

          <button
            type="button"
            onClick={goToPostChoice}
            disabled={isNavigating}
            className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            + Postează
          </button>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => changeTab("waiting")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === "waiting"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            În așteptare ({waitingRequests.length})
          </button>

          <button
            type="button"
            onClick={() => changeTab("with_offer")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
              activeTab === "with_offer"
                ? "bg-orange-500 text-black"
                : "bg-white/10 text-white"
            }`}
          >
            Cu ofertă ({withOfferRequests.length})
          </button>

          <button
            type="button"
            onClick={() => changeTab("archive")}
            disabled={isNavigating}
            className={`rounded-full px-4 py-2 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${
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
              type="button"
              onClick={goToPostChoice}
              disabled={isNavigating}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50"
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
                onEdit={() => goToRequest(request.id)}
                onView={() => handleViewRequest(request.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
