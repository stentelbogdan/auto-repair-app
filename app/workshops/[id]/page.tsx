"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import CarHeader from "@/app/components/CarHeader";
import { createRepairOffer } from "@/lib/supabase/repair-offers";

type RepairImage = {
  name?: string;
  url?: string;
  dataUrl?: string;
  thumbUrl?: string;
};

type ProfileRow = {
  role: string[] | null;
};

type RepairRequestRow = {
  id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  license_plate: string | null;
  damage_type: string;
  description: string | null;
  images: RepairImage[];
  status: string;
};

export default function WorkshopRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState("");

  const [availableDate, setAvailableDate] = useState("");
  const [availableTime, setAvailableTime] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");

    const savedAvailability = sessionStorage.getItem(`availability-${id}`);

    if (savedAvailability) {
      const parsed = JSON.parse(savedAvailability);

      setAvailableDate(parsed.date || "");
      setAvailableTime(parsed.time || "");
      setPrice(parsed.price || "");
      setDays(parsed.days || "");
      setMessage(parsed.message || "");
    }

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
          .select(
            "id, car_brand, car_model, car_year, city, license_plate, damage_type, description, images, status",
          )
          .eq("id", id)
          .single<RepairRequestRow>();

        if (error || !data) {
          setRequest(null);
          return;
        }

        setRequest(data);
      } catch {
        setRequest(null);
      } finally {
        setLoading(false);
      }
    };

    loadRequest();
  }, [id, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting || !request) return;

    if (!price || !days || !availableDate || !availableTime) {
      alert("Completează prețul, durata, data și ora.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const { data: workshopProfile } = await supabase
        .from("profiles")
        .select("workshop_name")
        .eq("id", authData.user.id)
        .single();

      const workshopEmail = authData.user.email ?? "Workshop";

      const workshopName =
        workshopProfile?.workshop_name?.trim() ||
        workshopEmail.split("@")[0] ||
        "Workshop";

      await createRepairOffer({
        requestId: id,
        workshopUserId: authData.user.id,
        price,
        days,
        message,
        workshopName,
        availableDate,
        availableTime,
      });

      router.replace("/workshops/dashboard?offerSent=1");
    } catch (error: any) {
      alert(error?.message || "Nu am putut trimite oferta.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  if (!request) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Dauna nu a fost găsită.
      </main>
    );
  }

  const isClosed = request.status === "completed";

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => router.push("/workshops")}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
        >
          Înapoi
        </button>

        <section className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            Detalii daună
          </p>

          <h1 className="mt-2 text-3xl font-black leading-tight">
            Evaluează lucrarea
          </h1>

          <p className="mt-2 text-sm leading-6 text-white/55">
            Verifică pozele și detaliile clientului înainte să trimiți oferta.
          </p>
        </section>

        <section className="rounded-[30px] bg-white p-4 text-black shadow-xl">
          <CarHeader
            images={request.images || []}
            plate={request.license_plate}
            platePosition="bottom"
            brand={request.car_brand}
            model={request.car_model}
            year={request.car_year}
            city={request.city}
            variant="listLarge"
            details={[
              {
                text: isClosed ? "Închisă" : "Deschisă",
                color: isClosed ? "red" : "yellow",
              },
              {
                text: formatDamageType(request.damage_type),
                color: "orange",
              },
            ]}
          />

          <div className="mt-5 rounded-2xl border border-black/10 bg-black/[0.03] p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/40">
              Descriere client
            </p>

            <p className="mt-3 text-sm leading-6 text-black/70">
              {request.description || "Clientul nu a adăugat descriere."}
            </p>
          </div>
        </section>

        <form
          onSubmit={handleSubmit}
          className="mt-5 rounded-[30px] bg-white p-5 text-black shadow-xl"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/40">
            Oferta ta
          </p>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold">
              Preț ofertă (€)
            </label>

            <input
              type="number"
              min="1"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="450"
              className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 text-base outline-none"
              required
            />
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold">
              Durată estimată
            </label>

            <select
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 text-base outline-none"
              required
            >
              <option value="">Alege durata estimată</option>
              <option value="30 minute">30 minute</option>
              <option value="1 oră">1 oră</option>
              <option value="2 ore">2 ore</option>
              <option value="3 ore">3 ore</option>
              <option value="Jumătate de zi">Jumătate de zi</option>
              <option value="1 zi">1 zi</option>
              <option value="2 zile">2 zile</option>
              <option value="3 zile">3 zile</option>
              <option value="4-5 zile">4-5 zile</option>
              <option value="O săptămână">O săptămână</option>
            </select>
          </div>

          <div className="mt-5 rounded-2xl border border-orange-200 bg-orange-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
              Disponibilitate service
            </p>

            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem(
                  `availability-${request.id}`,
                  JSON.stringify({
                    date: availableDate,
                    time: availableTime,
                    price,
                    days,
                    message,
                  }),
                );

                router.push(`/workshops/${request.id}/calendar`);
              }}
              className="mt-3 flex w-full items-center justify-between rounded-2xl bg-white px-4 py-4 text-left shadow-sm transition hover:bg-orange-50"
            >
              <div>
                <p className="text-sm font-bold text-black">
                  {availableDate
                    ? formatDisplayDate(availableDate) + " • " + availableTime
                    : "Alege din calendar"}
                </p>

                <p className="mt-1 text-xs text-black/50">
                  Vezi toate programările și orele disponibile.
                </p>
              </div>

              <span className="text-2xl">📅</span>
            </button>
          </div>

          <div className="mt-4">
            <label className="mb-2 block text-sm font-bold">
              Mesaj pentru client
            </label>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Putem repara această daună rapid și profesional."
              rows={5}
              className="w-full resize-none rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 text-base outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting || isClosed}
            className="mt-6 w-full rounded-full bg-orange-500 px-6 py-4 text-base font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
          >
            {isSubmitting
              ? "Se trimite..."
              : isClosed
                ? "Oferta este închisă"
                : "Trimite oferta"}
          </button>
        </form>
      </div>
    </main>
  );
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
      return "Zgârietură";
    case "dent":
      return "Îndoitură";
    case "bumper":
      return "Bară avariată";
    case "paint":
      return "Problemă vopsea";
    case "cracked_part":
      return "Element crăpat";
    default:
      return "Altă daună";
  }
}

function formatDisplayDate(value: string) {
  if (!value) return "";

  const [year, month, day] = value.split("-");

  if (!year || !month || !day) return value;

  return `${day}-${month}-${year}`;
}
