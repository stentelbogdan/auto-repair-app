"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairOffer } from "@/lib/supabase/repair-offers";

type RepairRequestRow = {
  id: string;
  status: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
};

type ProfileRow = {
  role: string[] | null;
};

export default function MakeOfferPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
    const loadRequest = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        const { data, error } = await supabase
          .from("repair_requests")
          .select("id, status, car_brand, car_model, car_year, city")
          .eq("id", id)
          .single<RepairRequestRow>();

        if (error || !data) {
          router.push("/workshops");
          return;
        }

        setRequest(data);

        if (data.status === "matched") {
          setIsClosed(true);
        }
      } catch {
        router.push("/workshops");
      } finally {
        setIsLoaded(true);
      }
    };

    loadRequest();
  }, [id, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isClosed || isSubmitting) return;

    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const workshopEmail = authData.user.email ?? "Workshop";
      const workshopName = workshopEmail.split("@")[0] || "Workshop";

      await createRepairOffer({
        requestId: id,
        workshopUserId: authData.user.id,
        price,
        days,
        message,
        workshopName,
      });

      router.push("/workshops/my-offers");
    } catch (error: any) {
      alert(error?.message || "Nu am putut trimite oferta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  if (isClosed) {
    return (
      <main className="min-h-screen bg-black px-4 py-8 text-white">
        <div className="mx-auto max-w-md">
          <div className="rounded-[28px] bg-white p-6 text-center text-black shadow-xl">
            <h1 className="text-2xl font-bold">Oferta este închisă</h1>
            <p className="mt-2 text-sm text-black/55">
              Această daună are deja o ofertă acceptată.
            </p>

            <button
              onClick={() => router.push(`/workshops/${id}`)}
              className="mt-6 rounded-full bg-black px-6 py-3 text-sm font-semibold text-white"
            >
              Înapoi la daună
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => router.push(`/workshops/${id}`)}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
        >
          Înapoi
        </button>

        <section className="mb-6 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            TRIMITE OFERTĂ
          </p>

          {request && (
            <h1 className="mt-3 text-2xl font-bold">
              {request.car_brand} {request.car_model}
            </h1>
          )}

          {request && (
            <p className="mt-2 text-sm text-white/55">
              {request.car_year} • {request.city}
            </p>
          )}
        </section>

        <form
          onSubmit={handleSubmit}
          className="rounded-[28px] bg-white p-5 text-black shadow-xl"
        >
          <div>
            <label className="mb-2 block text-sm font-semibold">
              Preț ofertă (€)
            </label>
            <input
              type="number"
              min="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="450"
              className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-base outline-none focus:border-black/30"
              required
            />
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold">
              Durată estimată (zile)
            </label>
            <input
              type="number"
              min="1"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="3"
              className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-base outline-none focus:border-black/30"
              required
            />
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-semibold">
              Mesaj pentru client
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Putem repara această daună rapid și profesional."
              rows={5}
              className="w-full resize-none rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-base outline-none focus:border-black/30"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full rounded-full bg-black px-6 py-3 font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            {isSubmitting ? "Se trimite..." : "Trimite oferta"}
          </button>
        </form>
      </div>
    </main>
  );
}