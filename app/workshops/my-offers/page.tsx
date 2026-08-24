"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { acceptRepairOffer } from "@/lib/supabase/repair-offers";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";
import { markNotificationsAsRead } from "@/lib/notifications";
import {
  getDamageTypeLabel,
  getRequestTypeBadgeLabel,
} from "@/lib/displayLabels";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
} from "@/lib/car-damage";
import type { RepairServiceDetails } from "@/lib/supabase/repair-requests";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { getWorkshopRequestClientNames } from "@/lib/supabase/workshop-client-names";
import RequestClientName from "@/app/components/RequestClientName";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";

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
  service_type: RepairServiceType | null;
  service_details?: RepairServiceDetails | null;
  description: string | null;
  status?: string | null;
  accepted_offer_id?: string | null;
  images?: RepairImage[];
  clientName: string | null;
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

    let cancelled = false;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    const loadWorkshopOffers = async (workshopUserId: string) => {
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
            service_type,
            service_details,
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
        .eq("workshop_user_id", workshopUserId)
        .order("created_at", { ascending: false });

      if (error) {
        throw error;
      }

      if (cancelled) {
        return;
      }

      const requestIds = (data ?? []).flatMap((row) => {
        const request = Array.isArray(row.repair_requests)
          ? row.repair_requests[0]
          : row.repair_requests;

        return request?.id ? [String(request.id)] : [];
      });
      const clientNamesByRequestId = await getWorkshopRequestClientNames(
        requestIds,
      );

      if (cancelled) {
        return;
      }

      const mapped: RepairOffer[] = (data ?? []).map((row) => {
        const request = Array.isArray(row.repair_requests)
          ? row.repair_requests[0]
          : row.repair_requests;

        return {
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

          repair_requests: request
            ? {
                id: String(request.id),
                car_brand: request.car_brand ?? null,
                car_model: request.car_model ?? null,
                car_year: request.car_year ?? null,
                city: request.city ?? null,
                license_plate: request.license_plate ?? null,
                damage_type: request.damage_type ?? null,
                service_type: request.service_type ?? null,
                service_details: request.service_details ?? null,
                description: request.description ?? null,
                status: request.status ?? null,
                accepted_offer_id: request.accepted_offer_id ?? null,
                images: Array.isArray(request.images) ? request.images : [],
                clientName:
                  clientNamesByRequestId.get(String(request.id)) ?? null,
              }
            : null,

          repair_appointments: Array.isArray(row.repair_appointments)
            ? row.repair_appointments.map((appointment) => ({
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
        };
      });

      setOffers(mapped);
    };

    const loadPage = async () => {
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
          router.replace("/login");
          return;
        }

        const workshopUserId = authData.user.id;

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", workshopUserId)
          .single<ProfileRow>();

        if (cancelled) {
          return;
        }

        if (profileError) {
          throw profileError;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.replace("/");
          return;
        }

        setAuthorized(true);

        await loadWorkshopOffers(workshopUserId);

        if (cancelled) {
          return;
        }

        /*
         * Ascultăm modificările ofertelor acestui service.
         * Când clientul acceptă, statusul ofertei se schimbă.
         */
        realtimeChannel = supabase
          .channel(`workshop-my-offers-${workshopUserId}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "repair_offers",
              filter: `workshop_user_id=eq.${workshopUserId}`,
            },
            () => {
              void loadWorkshopOffers(workshopUserId);
            },
          )
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "repair_appointments",
              filter: `workshop_id=eq.${workshopUserId}`,
            },
            () => {
              void loadWorkshopOffers(workshopUserId);
            },
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "repair_requests",
            },
            () => {
              void loadWorkshopOffers(workshopUserId);
            },
          )
          .subscribe();
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load workshop offers:", error);
        setOffers([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setCheckingAccess(false);
        }
      }
    };

    void loadPage();

    return () => {
      cancelled = true;

      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [router]);

  useEffect(() => {
    if (!authorized) return;

    markNotificationsAsRead({
      recipientRole: "workshop",
      types: ["customer_proposed_appointment"],
    });
  }, [authorized]);

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

      const { error: workshopReadError } = await supabase
        .from("repair_offers")
        .update({
          workshop_read_at: new Date().toISOString(),
        })
        .eq("id", offer.id)
        .eq("workshop_user_id", offer.workshop_user_id);

      if (workshopReadError) {
        console.error(
          "Failed to keep the confirmed offer marked as read:",
          workshopReadError,
        );
      }

      window.dispatchEvent(new Event("appointments-updated"));
      window.dispatchEvent(new Event("offers-read-updated"));

      router.push("/workshops/dashboard");
    } catch (error) {
      console.error("Failed to confirm appointment:", error);

      const supabaseError = error as {
        code?: string;
        message?: string;
      };

      if (supabaseError?.code === "23505") {
        alert(
          "Ora propusă nu mai este disponibilă. Alege o altă dată sau oră.",
        );
        return;
      }

      alert(supabaseError?.message || "Nu am putut confirma programarea.");
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
              const affectedPartLabels = getAffectedPartLabels(
                request?.service_details,
              );
              const detailedDamageTypeLabels = getDamageTypeLabels(
                request?.service_details,
              );
              const fallbackDamageTypeLabel = getDamageTypeLabel(
                request?.damage_type,
              );
              const mechanicalDetails =
                request?.service_type === "mechanical"
                  ? getMechanicalServiceDetailGroups(request.service_details)
                  : [];
              const displayedDamageTypeLabels =
                detailedDamageTypeLabels.length > 0
                  ? detailedDamageTypeLabels
                  : fallbackDamageTypeLabel
                    ? [fallbackDamageTypeLabel]
                    : [];

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
                    affectedParts={affectedPartLabels}
                    damageTypes={
                      mechanicalDetails.length > 0
                        ? []
                        : displayedDamageTypeLabels
                    }
                    mechanicalDetails={mechanicalDetails}
                    details={[
                      workshopBadge,
                      {
                        text: getRequestTypeBadgeLabel(request?.service_type),
                        color: "orange",
                      },
                    ]}
                  />

                  <RequestClientName name={request?.clientName} />

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
