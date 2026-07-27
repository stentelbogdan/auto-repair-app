"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import Car3DViewer from "@/app/components/car-3d/Car3DViewer";

type ProfileRow = {
  role: string[] | null;
};

export default function CustomerDashboardPage() {
  return (
    <Suspense fallback={null}>
      <CustomerDashboardContent />
    </Suspense>
  );
}

function CustomerDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const showAppointmentToast = searchParams.get("appointmentSent") === "1";

  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [isWorkshop, setIsWorkshop] = useState<boolean | null>(null);
  const [receivedOffersCount, setReceivedOffersCount] = useState(0);
  const [appointmentsCount, setAppointmentsCount] = useState(0);

  useEffect(() => {
    if (!showAppointmentToast) return;

    const timer = setTimeout(() => {
      router.replace("/customer/dashboard");
    }, 1500);

    return () => clearTimeout(timer);
  }, [showAppointmentToast, router]);

  useEffect(() => {
    const loadRole = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.replace("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single<ProfileRow>();

      const roles = Array.isArray(profile?.role) ? profile.role : [];

      const savedRole = localStorage.getItem("activeRole");

      if (savedRole === "workshop" && roles.includes("workshop")) {
        router.replace("/workshops/dashboard");
        return;
      }

      const userId = session.user.id;

      const { count: offersCount } = await supabase
        .from("repair_offers")
        .select("*, repair_requests!inner(user_id)", {
          count: "exact",
          head: true,
        })
        .eq("repair_requests.user_id", userId)
        .eq("status", "pending");

      const { count: jobsCount } = await supabase
        .from("repair_requests")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("user_id", userId)
        .in("status", ["matched", "in_progress"]);

      setReceivedOffersCount(offersCount || 0);
      setAppointmentsCount(jobsCount || 0);

      setIsWorkshop(savedRole === "workshop" && roles.includes("workshop"));
    };

    loadRole();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        setIsWorkshop(null);
        router.replace("/login");
        router.refresh();
      }
    });

    return () => subscription.unsubscribe();
  }, [router]);

  useEffect(() => {
    if (sessionStorage.getItem("job-posted-success") !== "true") {
      return;
    }

    sessionStorage.removeItem("job-posted-success");
    setShowSuccessToast(true);

    const timer = setTimeout(() => {
      setShowSuccessToast(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (isWorkshop === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  return (
    <main className="relative h-[calc(100svh-236px)] overflow-hidden bg-black px-4 pb-4 pt-3 text-white">
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

      <div className="mx-auto flex h-full max-w-md flex-col md:max-w-5xl">
        <section className="shrink-0 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            PANOU CLIENT
          </p>
        </section>

        {!isWorkshop && (
          <>
            <section className="relative mt-2 shrink-0 overflow-hidden rounded-[32px] bg-gradient-to-b from-[#2a303a] via-[#222832] to-[#1b2028] shadow-[0_18px_45px_rgba(0,0,0,0.22)]">
              <div className="pointer-events-none absolute inset-x-[12%] top-[18%] h-[55%] rounded-full bg-white/[0.045] blur-3xl" />

              <Car3DViewer
                mode="preview"
                heightClassName="h-[125px] [@media(min-height:700px)]:h-[clamp(200px,27svh,280px)]"
              />
            </section>

            <section className="relative z-10 mt-auto grid shrink-0 -translate-y-8 grid-cols-2 gap-3 pt-3 md:mx-auto md:w-full md:max-w-3xl md:gap-6">
              <Card
                title="Postează daună"
                desc="Estetică sau mecanică"
                icon="🚗"
                onClick={() => router.push("/post-choice")}
              />

              <Card
                title="Cererile mele"
                desc="Daune postate"
                icon="📋"
                onClick={() => router.push("/customer/my-requests")}
              />

              <Card
                title="Oferte primite"
                desc="Compară ofertele"
                icon="€"
                value={receivedOffersCount}
                onClick={() => router.push("/offers")}
              />

              <Card
                title="Programări"
                desc="Lucrări active"
                icon="✓"
                value={appointmentsCount}
                onClick={() => router.push("/customer/my-jobs")}
              />
            </section>
          </>
        )}

        {isWorkshop && (
          <section className="mt-auto grid grid-cols-2 gap-3 md:mx-auto md:w-full md:max-w-3xl md:gap-6">
            <Card
              title="Daune disponibile"
              desc="Vezi cererile clienților"
              icon="🔎"
              onClick={() => router.push("/workshops")}
            />

            <Card
              title="Ofertele tale"
              desc="Toate ofertele trimise"
              icon="€"
              onClick={() => router.push("/workshops/my-offers")}
            />

            <Card
              title="Lucrări câștigate"
              desc="Joburi acceptate"
              icon="✓"
              onClick={() => router.push("/workshops/won-jobs")}
            />
          </section>
        )}
      </div>
    </main>
  );
}

function Card({
  title,
  desc,
  icon,
  value,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  value?: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 active:scale-[0.98] hover:scale-[1.02] md:p-6 md:hover:shadow-2xl"
    >
      {typeof value !== "undefined" && (
        <div className="absolute right-4 top-4 rounded-full bg-black px-2.5 py-1 text-xs font-semibold text-white shadow-md">
          {value}
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
