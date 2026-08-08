"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";

type ProfileRow = {
  role: string[] | null;
};

export default function CustomerDashboardPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-black text-white">
          Se încarcă...
        </main>
      }
    >
      <CustomerDashboardContent />
    </Suspense>
  );
}

function CustomerDashboardContent() {
  /*
   * Routerul normal rămâne doar pentru redirecturi automate:
   * - login;
   * - profil service;
   * - eliminarea parametrului appointmentSent.
   */
  const router = useRouter();
  const searchParams = useSearchParams();

  /*
   * Navigările făcute prin apăsarea utilizatorului
   * trec prin hook-ul comun.
   */
  const { navigate, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const showAppointmentToast = searchParams.get("appointmentSent") === "1";

  const [loading, setLoading] = useState(true);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [receivedOffersCount, setReceivedOffersCount] = useState(0);
  const [appointmentsCount, setAppointmentsCount] = useState(0);

  /*
   * Eliminăm automat parametrul appointmentSent după afișarea toastului.
   */
  useEffect(() => {
    if (!showAppointmentToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      router.replace("/customer/dashboard");
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [showAppointmentToast, router]);

  /*
   * Încărcăm sesiunea, rolul și numărul de oferte/programări.
   */
  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async () => {
      try {
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (cancelled) {
          return;
        }

        if (sessionError) {
          throw sessionError;
        }

        if (!session) {
          router.replace("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single<ProfileRow>();

        if (cancelled) {
          return;
        }

        if (profileError) {
          throw profileError;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        const savedRole = localStorage.getItem("activeRole");

        /*
         * Dacă utilizatorul se află în modul service,
         * îl trimitem automat către Dashboard Service.
         */
        if (savedRole === "workshop" && roles.includes("workshop")) {
          router.replace("/workshops/dashboard");
          return;
        }

        /*
         * Suntem pe Dashboard Client.
         */
        localStorage.setItem("activeRole", "customer");

        const userId = session.user.id;

        const [offersResult, appointmentsResult] = await Promise.all([
          supabase
            .from("repair_offers")
            .select("*, repair_requests!inner(user_id)", {
              count: "exact",
              head: true,
            })
            .eq("repair_requests.user_id", userId)
            .eq("status", "pending"),

          supabase
            .from("repair_requests")
            .select("id", {
              count: "exact",
              head: true,
            })
            .eq("user_id", userId)
            .in("status", ["matched", "in_progress"]),
        ]);

        if (cancelled) {
          return;
        }

        if (offersResult.error) {
          console.error(
            "Failed to load received offers count:",
            offersResult.error,
          );
        }

        if (appointmentsResult.error) {
          console.error(
            "Failed to load appointments count:",
            appointmentsResult.error,
          );
        }

        setReceivedOffersCount(offersResult.count || 0);
        setAppointmentsCount(appointmentsResult.count || 0);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load customer dashboard:", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadDashboard();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        router.replace("/login");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router]);

  /*
   * Toast după publicarea unei cereri.
   */
  useEffect(() => {
    if (sessionStorage.getItem("job-posted-success") !== "true") {
      return;
    }

    sessionStorage.removeItem("job-posted-success");
    setShowSuccessToast(true);

    const timer = window.setTimeout(() => {
      setShowSuccessToast(false);
    }, 3000);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    router.prefetch("/post-choice");
    router.prefetch("/customer/my-requests");
    router.prefetch("/offers");
    router.prefetch("/customer/my-jobs");
  }, [router]);

  if (loading) {
    return (
      <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  return (
    <main className="relative min-h-[calc(100svh-236px)] overflow-x-hidden bg-black px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 text-white">
      {(showAppointmentToast || showSuccessToast) && (
        <div className="pointer-events-none absolute left-4 right-4 top-3 z-50 mx-auto max-w-md md:max-w-5xl">
          {showAppointmentToast && (
            <div className="rounded-2xl border border-green-500/30 bg-[#132017]/95 p-4 shadow-xl backdrop-blur">
              <p className="text-sm font-bold text-green-300">
                ✅ Programarea a fost trimisă.
              </p>

              <p className="mt-1 text-xs text-green-100/80">
                Service-ul va confirma în cel mai scurt timp.
              </p>
            </div>
          )}

          {showSuccessToast && (
            <div className="rounded-2xl border border-green-500/30 bg-[#132017]/95 px-4 py-3 shadow-xl backdrop-blur">
              <p className="text-sm font-bold text-green-300">
                ✅ Cererea a fost publicată!
              </p>

              <p className="mt-1 text-xs text-green-100/80">
                Service-urile pot începe să trimită oferte în câteva momente.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mx-auto max-w-md md:max-w-5xl">
        <section className="text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            PANOU CLIENT
          </p>
        </section>

        <section className="mt-8 grid grid-cols-2 gap-3 md:mx-auto md:w-full md:max-w-3xl md:gap-6">
          <Card
            title="Postează daună"
            desc="Estetică sau mecanică"
            icon="🚗"
            disabled={isNavigating}
            onClick={() => navigate("/post-choice")}
          />

          <Card
            title="Cererile mele"
            desc="Daune postate"
            icon="📋"
            disabled={isNavigating}
            onClick={() => navigate("/customer/my-requests")}
          />

          <Card
            title="Oferte primite"
            desc="Compară ofertele"
            icon="€"
            value={receivedOffersCount}
            disabled={isNavigating}
            onClick={() => navigate("/offers")}
          />

          <Card
            title="Programări"
            desc="Lucrări active"
            icon="✓"
            value={appointmentsCount}
            disabled={isNavigating}
            onClick={() => navigate("/customer/my-jobs")}
          />
        </section>
      </div>
    </main>
  );
}

function Card({
  title,
  desc,
  icon,
  value,
  disabled = false,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  value?: string | number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative min-h-[150px] rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition-transform duration-75 active:scale-[0.995] disabled:cursor-not-allowed md:min-h-[180px] md:p-6 md:hover:scale-[1.02] md:hover:shadow-2xl"
    >
      {typeof value !== "undefined" && Number(value) > 0 && (
        <div className="absolute right-4 top-4 flex h-7 min-w-7 items-center justify-center rounded-full bg-black px-2 text-xs font-semibold text-white shadow-md">
          {Number(value) > 9 ? "9+" : value}
        </div>
      )}

      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold md:h-14 md:w-14 md:text-3xl">
        {icon}
      </div>

      <h2 className="text-base font-bold leading-tight md:text-lg">{title}</h2>

      <p className="mt-1 text-xs leading-snug text-black/55 md:text-sm">
        {desc}
      </p>
    </button>
  );
}
