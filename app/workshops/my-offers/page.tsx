"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { acceptRepairOffer } from "@/lib/supabase/repair-offers";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";

type ProfileRow = {
  role: string[] | null;
};

type RepairImage = {
  name?: string;
  url?: string;
  dataUrl?: string;
};

type RepairRequest = {
  id: string;
  car_brand: string | null;
  car_model: string | null;
  car_year: string | null;
  city: string | null;
  license_plate: string | null;
  damage_type: string | null;
  description: string | null;
  status?: string | null;
  accepted_offer_id?: string | null;
  images?: RepairImage[];
};

type RepairAppointment = {
  id: string;
  offer_id: string;
  request_id: string;
  appointment_date: string | null;
  appointment_time: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  status: string | null;
};

type RepairOffer = {
  id: string;
  request_id: string;
  workshop_user_id: string;
  workshop_name: string;
  price: number | string;
  days: number | string;
  message: string | null;
  status?: string | null;
  created_at: string;
  available_date?: string | null;
  available_time?: string | null;
  repair_requests?: RepairRequest | null;
  repair_appointments?: RepairAppointment[] | null;
};

type DerivedOffer = RepairOffer & {
  derivedStatus: "pending";
};

export default function WorkshopMyOffersPage() {
  const router = useRouter();

  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [offers, setOffers] = useState<RepairOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const [confirmingOfferId, setConfirmingOfferId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");
    let isMounted = true;

    async function loadPage() {
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

        if (!isMounted) return;
        setAuthorized(true);

        const { data, error } = await supabase
          .from("repair_offers")
          .select(
            `
  id,
  request_id,
  workshop_user_id,
  workshop_name,
  price,
  days,
  message,
  status,
  created_at,
  available_date,
available_time,
  repair_requests (
    id,
    car_brand,
    car_model,
    car_year,
    city,
    license_plate,
    damage_type,
    description,
    status,
    accepted_offer_id,
    images
  ),
  repair_appointments (
  id,
  offer_id,
  request_id,
  appointment_date,
  appointment_time,
  proposed_date,
  proposed_time,
  status
)
`,
          )
          .eq("workshop_user_id", authData.user.id)
          .order("created_at", { ascending: false });

        if (error) throw error;

        if (!isMounted) return;

        const mapped: RepairOffer[] = (data ?? []).map((row: any) => ({
          id: String(row.id),
          request_id: String(row.request_id),
          workshop_user_id: String(row.workshop_user_id),
          workshop_name: row.workshop_name || "",
          price: row.price ?? "",
          days: row.days ?? "",
          message: row.message || "",
          status: row.status || "pending",
          created_at: String(row.created_at),
          available_date: row.available_date ?? null,
          available_time: row.available_time ?? null,
          repair_requests: row.repair_requests
            ? {
                id: String(row.repair_requests.id),
                car_brand: row.repair_requests.car_brand ?? null,
                car_model: row.repair_requests.car_model ?? null,
                car_year: row.repair_requests.car_year ?? null,
                city: row.repair_requests.city ?? null,
                license_plate: row.repair_requests.license_plate ?? null,
                damage_type: row.repair_requests.damage_type ?? null,
                description: row.repair_requests.description ?? null,
                status: row.repair_requests.status ?? null,
                accepted_offer_id:
                  row.repair_requests.accepted_offer_id ?? null,
                images: Array.isArray(row.repair_requests.images)
                  ? row.repair_requests.images
                  : [],
              }
            : null,
          repair_appointments: Array.isArray(row.repair_appointments)
            ? row.repair_appointments.map((appointment: any) => ({
                id: String(appointment.id),
                offer_id: String(appointment.offer_id),
                request_id: String(appointment.request_id),
                appointment_date: appointment.appointment_date ?? null,
                appointment_time: appointment.appointment_time ?? null,
                proposed_date: appointment.proposed_date ?? null,
                proposed_time: appointment.proposed_time ?? null,
                status: appointment.status ?? null,
              }))
            : [],
        }));

        setOffers(mapped);
      } catch (error) {
        console.error("Failed to load workshop offers:", error);
        setOffers([]);
      } finally {
        if (isMounted) {
          setLoading(false);
          setCheckingAccess(false);
        }
      }
    }

    loadPage();

    return () => {
      isMounted = false;
    };
  }, [router]);

  const normalizedOffers = useMemo<DerivedOffer[]>(() => {
    return offers
      .filter((offer) => {
        const appointment = offer.repair_appointments?.[0];

        if (!appointment) {
          return (offer.status || "pending") === "pending";
        }

        return appointment.status !== "confirmed";
      })
      .map((offer) => ({
        ...offer,
        derivedStatus: "pending" as const,
      }))
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
  }, [offers]);

  if (checkingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se verifică accesul...
      </main>
    );
  }

  if (!authorized) return null;

  const confirmAppointment = async (
    offer: RepairOffer,
    appointment: RepairAppointment,
  ) => {
    if (confirmingOfferId) return;

    try {
      setConfirmingOfferId(offer.id);

      const request = offer.repair_requests;

      if (!request?.id) {
        throw new Error("Lucrarea asociată ofertei nu a fost găsită.");
      }

      if (appointment.status !== "customer_proposed") {
        throw new Error(
          "Această programare nu mai poate fi confirmată de service.",
        );
      }

      const confirmedDate =
        appointment.proposed_date ||
        appointment.appointment_date ||
        offer.available_date;

      const confirmedTime =
        appointment.proposed_time ||
        appointment.appointment_time ||
        offer.available_time;

      if (!confirmedDate || !confirmedTime) {
        throw new Error("Programarea nu are o dată și o oră valide.");
      }

      const { error: appointmentError } = await supabase
        .from("repair_appointments")
        .update({
          status: "confirmed",
          appointment_date: confirmedDate,
          appointment_time: confirmedTime,
          proposed_date: null,
          proposed_time: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", appointment.id)
        .eq("offer_id", offer.id);

      if (appointmentError) {
        throw appointmentError;
      }

      await acceptRepairOffer({
        offerId: offer.id,
        requestId: request.id,
      });

      window.dispatchEvent(new Event("appointments-updated"));
      window.dispatchEvent(new Event("offers-read-updated"));

      router.push("/workshops/won-jobs?tab=appointments");
    } catch (error) {
      console.error("Failed to confirm appointment:", error);

      const message =
        error instanceof Error
          ? error.message
          : "Nu am putut confirma programarea.";

      alert(message);
    } finally {
      setConfirmingOfferId(null);
    }
  };

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <p className="text-sm uppercase tracking-[0.24em] text-orange-400">
            Service auto
          </p>
          <h1 className="mt-2 text-4xl font-black">Oferte trimise</h1>
          <p className="mt-3 max-w-2xl text-white/60">
            Aici vezi doar ofertele care așteaptă răspunsul clientului.
          </p>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Se încarcă ofertele...
          </div>
        ) : normalizedOffers.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center">
            <h2 className="text-2xl font-bold">Nu ai oferte în așteptare</h2>
            <p className="mt-3 text-white/60">
              Ofertele acceptate de client apar în Lucrări câștigate.
            </p>

            <button
              onClick={() => router.push("/workshops")}
              className="mt-6 rounded-2xl bg-white px-6 py-4 font-bold text-black"
            >
              Vezi daune disponibile
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {normalizedOffers.map((offer) => {
              const request = offer.repair_requests;
              const appointment = offer.repair_appointments?.[0];

              const workshopBadge =
                appointment?.status === "confirmed"
                  ? {
                      text: "Programare confirmată",
                      color: "green" as const,
                    }
                  : appointment?.status === "customer_proposed"
                    ? {
                        text: "Clientul a propus altă dată",
                        color: "orange" as const,
                      }
                    : appointment?.status === "workshop_proposed"
                      ? {
                          text: "În așteptare",
                          color: "yellow" as const,
                        }
                      : {
                          text: "Așteaptă confirmarea clientului",
                          color: "yellow" as const,
                        };

              const displayDate =
                appointment?.status === "customer_proposed"
                  ? appointment.proposed_date ||
                    appointment.appointment_date ||
                    offer.available_date
                  : appointment?.proposed_date ||
                    appointment?.appointment_date ||
                    offer.available_date;

              const displayTime =
                appointment?.status === "customer_proposed"
                  ? appointment.proposed_time ||
                    appointment.appointment_time ||
                    offer.available_time
                  : appointment?.proposed_time ||
                    appointment?.appointment_time ||
                    offer.available_time;

              return (
                <article
                  key={offer.id}
                  className="rounded-[28px] bg-white p-5 text-black shadow-lg"
                >
                  <CarHeader
                    images={request?.images || []}
                    plate={request?.license_plate || null}
                    brand={request?.car_brand || "Mașină"}
                    model={request?.car_model || ""}
                    year={request?.car_year || ""}
                    city={request?.city || ""}
                    variant="listLarge"
                    platePosition="bottom"
                    details={[
                      workshopBadge,
                      {
                        text: request?.damage_type || "Daună",
                        color: "yellow",
                      },
                    ]}
                  />

                  <OfferSummaryCard
                    price={offer.price}
                    days={offer.days}
                    appointmentDate={displayDate}
                    appointmentTime={displayTime}
                    handoverText="Predare la service"
                    statusText={
                      appointment?.status === "customer_proposed"
                        ? "Clientul a propus altă dată"
                        : appointment?.status === "workshop_proposed"
                          ? "Așteaptă confirmarea clientului"
                          : "Așteaptă confirmare"
                    }
                    title="Oferta service-ului"
                  />

                  {offer.message && (
                    <div className="mt-4 rounded-[24px] bg-gray-100 p-5">
                      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/45">
                        Mesaj service
                      </p>

                      <p className="mt-3 text-sm leading-6 text-black/80">
                        {offer.message}
                      </p>
                    </div>
                  )}

                  <AppointmentActions
                    showConfirm={appointment?.status === "customer_proposed"}
                    confirming={confirmingOfferId === offer.id}
                    confirmDisabled={confirmingOfferId === offer.id}
                    onConfirm={() => {
                      if (!appointment) {
                        alert("Programarea nu a fost găsită.");
                        return;
                      }

                      confirmAppointment(offer, appointment);
                    }}
                    onChat={() => {
                      if (!request?.id) {
                        alert("Lucrarea nu a fost găsită.");
                        return;
                      }

                      router.push(`/chat/${request.id}?offerId=${offer.id}`);
                    }}
                    onChangeDate={() => {
                      if (!request?.id) {
                        alert("Lucrarea nu a fost găsită.");
                        return;
                      }

                      router.push(
                        `/customer/schedule-damage/${request.id}?offerId=${offer.id}&from=workshop`,
                      );
                    }}
                  />
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
