"use client";

import { getOwnProfile } from "@/lib/supabase/profiles";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { finalizeWorkshopCustomerProposal } from "@/lib/supabase/repair-offers";
import { loadWorkshopOfferRequests } from "@/lib/supabase/workshop-offer-requests";
import type { WorkshopRequestDetail } from "@/lib/supabase/workshop-request-detail";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";
import TowingRouteEstimateCard from "@/app/components/towing/TowingRouteEstimateCard";
import TowingScheduleCard from "@/app/components/towing/TowingScheduleCard";
import {
  markNotificationsAsRead,
  WORKSHOP_OFFER_REJECTED_NOTIFICATION_TYPE,
  WORKSHOP_REQUEST_CLOSED_NOTIFICATION_TYPE,
} from "@/lib/notifications";
import {
  getDamageTypeLabel,
  getRequestTypeBadgeLabel,
} from "@/lib/displayLabels";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
} from "@/lib/car-damage";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { getWorkshopRequestClientNames } from "@/lib/supabase/workshop-client-names";
import RequestClientName from "@/app/components/RequestClientName";
import RepairRequestMetrics from "@/app/components/RepairRequestMetrics";
import {
  getWorkshopRequestMetrics,
  type RepairRequestMetrics as RepairRequestMetricsValue,
} from "@/lib/supabase/repair-request-metrics";
import {
  isRepairServiceType,
  resolveRepairServiceType,
} from "@/lib/repair-requests/service-types";
import { getTowingDisplaySummary } from "@/lib/towing/towing-display";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";
import RequestCategoryFilter, {
  type RequestCategoryCounts,
  type RequestCategoryFilter as RequestCategory,
} from "@/app/components/RequestCategoryFilter";

const OFFER_PAGE_TITLES: Record<RequestCategory, string> = {
  all: "OFERTELE TALE",
  bodywork: "DAUNE ESTETICE",
  mechanical: "DAUNE MECANICE",
  wheels: "ROȚI ȘI ANVELOPE",
  towing: "TRACTĂRI AUTO",
};

type RepairRequest = WorkshopRequestDetail & { clientName: string | null };

type RepairAppointment = {
  id: string;
  offer_id: string;
  request_id: string;
  appointment_date: string | null;
  appointment_time: string | null;
  proposed_date: string | null;
  proposed_time: string | null;
  handover_method: "customer_dropoff" | "workshop_pickup" | null;
  pickup_address: string | null;
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
  const [metricsByRequestId, setMetricsByRequestId] = useState<
    Map<string, RepairRequestMetricsValue>
  >(new Map());
  const [focusedRejectedOffer, setFocusedRejectedOffer] =
    useState<RepairOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeCategory, setActiveCategory] =
    useState<RequestCategory>("all");

  const [confirmingOfferId, setConfirmingOfferId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const category = new URLSearchParams(window.location.search).get(
      "category",
    );

    if (isRepairServiceType(category)) {
      setActiveCategory(category);
    }
  }, []);

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
          repair_appointments (
            id,
            offer_id,
            request_id,
            appointment_date,
            appointment_time,
            proposed_date,
            proposed_time,
            handover_method,
            pickup_address,
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

      const requests = await loadWorkshopOfferRequests(
        (data ?? []).map((row) => String(row.request_id)),
        () => cancelled,
      );
      if (cancelled) return;
      const requestIds = [...requests.values()].flatMap((request) => request ? [request.id] : []);
      const [clientNamesByRequestId, requestMetrics] = await Promise.all([
        getWorkshopRequestClientNames(requestIds).catch(() => new Map<string, string | null>()),
        getWorkshopRequestMetrics(requestIds).catch((error) => {
          console.error("Failed to load workshop request metrics:", error);
          return new Map<string, RepairRequestMetricsValue>();
        }),
      ]);

      if (cancelled) {
        return;
      }

      const mapped: RepairOffer[] = (data ?? []).map((row) => {
        const request = requests.get(String(row.request_id));

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
            ? { ...request, clientName: clientNamesByRequestId.get(request.id) ?? null }
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
                handover_method: appointment.handover_method ?? null,
                pickup_address: appointment.pickup_address ?? null,
                status: appointment.status ?? null,
              }))
            : [],
        };
      });

      setMetricsByRequestId(requestMetrics);
      setOffers(mapped);
      setLoadError(false);
      return requests;
    };

    const loadFocusedRejectedOffer = async (
      workshopUserId: string,
      initialRequests: Map<string, WorkshopRequestDetail | null>,
    ) => {
      const params = new URLSearchParams(window.location.search);
      const focusOfferId = params.get("focusOffer");

      if (!focusOfferId) {
        return;
      }

      const clearFocusOffer = () => {
        params.delete("focusOffer");
        const query = params.toString();
        router.replace(`/workshops/my-offers${query ? `?${query}` : ""}`, {
          scroll: false,
        });
      };

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
          repair_appointments (
            id,
            offer_id,
            request_id,
            appointment_date,
            appointment_time,
            proposed_date,
            proposed_time,
            handover_method,
            pickup_address,
            status
          )
        `,
        )
        .eq("id", focusOfferId)
        .eq("workshop_user_id", workshopUserId)
        .eq("status", "rejected")
        .maybeSingle();

      if (cancelled) return;
      if (error || !data) {
        if (error) {
          console.error("Failed to load rejected offer:", error);
        }
        clearFocusOffer();
        return;
      }

      const requestId = String(data.request_id);
      const requests = initialRequests.has(requestId)
        ? initialRequests
        : await loadWorkshopOfferRequests([requestId], () => cancelled);
      if (cancelled) return;
      const request = requests.get(requestId);
      const clientNamesByRequestId = await getWorkshopRequestClientNames(request ? [request.id] : []).catch(() => new Map<string, string | null>());

      if (cancelled) {
        return;
      }

      setFocusedRejectedOffer({
        id: String(data.id),
        request_id: String(data.request_id),
        workshop_user_id: String(data.workshop_user_id),
        workshop_name: data.workshop_name || "",
        price: data.price ?? "",
        days: data.days ?? "",
        message: data.message || "",
        status: data.status || "rejected",
        created_at: String(data.created_at),
        available_date: data.available_date ?? null,
        available_time: data.available_time ?? null,
        repair_requests: request
          ? { ...request, clientName: clientNamesByRequestId.get(request.id) ?? null }
          : null,
        repair_appointments: Array.isArray(data.repair_appointments)
          ? data.repair_appointments.map((appointment) => ({
              id: String(appointment.id),
              offer_id: String(appointment.offer_id),
              request_id: String(appointment.request_id),
              appointment_date: appointment.appointment_date ?? null,
              appointment_time: appointment.appointment_time ?? null,
              proposed_date: appointment.proposed_date ?? null,
              proposed_time: appointment.proposed_time ?? null,
              handover_method: appointment.handover_method ?? null,
              pickup_address: appointment.pickup_address ?? null,
              status: appointment.status ?? null,
            }))
          : [],
      });

      await markNotificationsAsRead({
        recipientRole: "workshop",
        types: [
          WORKSHOP_OFFER_REJECTED_NOTIFICATION_TYPE,
          WORKSHOP_REQUEST_CLOSED_NOTIFICATION_TYPE,
        ],
        offerId: String(data.id),
      });
      if (!cancelled) clearFocusOffer();
    };

    // Serialize refreshes and coalesce bursts; do not let older responses win.
    let refreshing = false;
    let refreshPending = false;
    const refreshOffers = async (workshopUserId: string) => {
      if (cancelled) return;
      if (refreshing) {
        refreshPending = true;
        return;
      }
      refreshing = true;
      try {
        do {
          refreshPending = false;
          try {
            await loadWorkshopOffers(workshopUserId);
          } catch {
            if (!cancelled) {
              setOffers([]);
              setLoadError(true);
            }
          }
        } while (refreshPending && !cancelled);
      } finally {
        refreshing = false;
      }
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

        const { data: profile, error: profileError } = await getOwnProfile(supabase);

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

        const requests = await loadWorkshopOffers(workshopUserId);
        if (cancelled) return;
        await loadFocusedRejectedOffer(workshopUserId, requests ?? new Map());

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
              void refreshOffers(workshopUserId);
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
              void refreshOffers(workshopUserId);
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
              void refreshOffers(workshopUserId);
            },
          )
          .subscribe();
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load workshop offers:", error);
        setOffers([]);
        setLoadError(true);
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
        if ((offer.status || "pending") !== "pending") {
          return false;
        }

        const appointment = offer.repair_appointments?.[0];

        if (!appointment) {
          return true;
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

  const categoryCounts = useMemo(() => {
    const counts: RequestCategoryCounts = {
      all: normalizedOffers.length,
      bodywork: 0,
      mechanical: 0,
      wheels: 0,
      towing: 0,
    };

    normalizedOffers.forEach((offer) => {
      if (!offer.repair_requests) return;
      const serviceType = resolveRepairServiceType(
        offer.repair_requests?.service_type,
      );

      if (serviceType) {
        counts[serviceType] += 1;
      }
    });

    return counts;
  }, [normalizedOffers]);

  const filteredOffers = useMemo(() => {
    if (activeCategory === "all") {
      return normalizedOffers;
    }

    return normalizedOffers.filter(
      (offer) =>
        offer.repair_requests && resolveRepairServiceType(offer.repair_requests?.service_type) ===
        activeCategory,
    );
  }, [activeCategory, normalizedOffers]);

  const displayedOffers = useMemo(() => {
    if (!focusedRejectedOffer) {
      return filteredOffers;
    }

    if (!focusedRejectedOffer.repair_requests && activeCategory !== "all") {
      return filteredOffers;
    }
    const focusedCategory = resolveRepairServiceType(
      focusedRejectedOffer.repair_requests?.service_type,
    );

    if (activeCategory !== "all" && focusedCategory !== activeCategory) {
      return filteredOffers;
    }

    return [focusedRejectedOffer, ...filteredOffers];
  }, [activeCategory, filteredOffers, focusedRejectedOffer]);

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

      if (!appointment.proposed_date || !appointment.proposed_time) {
        throw new Error("Programarea nu are o dată și o oră valide.");
      }

      await finalizeWorkshopCustomerProposal({
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
    <main className="min-h-screen bg-black px-6 pb-10 pt-6 text-white md:py-10">
      <div className="mx-auto max-w-6xl">
        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-orange-400">
            {OFFER_PAGE_TITLES[activeCategory]}
          </p>
        </section>

        <div className="mb-5">
          <RequestCategoryFilter
            activeCategory={activeCategory}
            counts={categoryCounts}
            onChange={(category) => {
              setFocusedRejectedOffer(null);
              setActiveCategory(category);
            }}
          />
        </div>

        {!loading && (normalizedOffers.some((offer) => !offer.repair_requests) ||
          (focusedRejectedOffer && !focusedRejectedOffer.repair_requests)) && (
          <p role="status" className="mb-5 text-sm text-white/70">
            Detaliile unor cereri nu sunt disponibile. Ofertele respective pot fi consultate în „Toate”; categoria și acțiunile lor nu sunt disponibile.
          </p>
        )}

        {loadError ? (
          <p role="alert" className="rounded-[28px] border border-white/10 p-5">
            Nu am putut încărca ofertele. Reîncarcă pagina pentru a încerca din nou.
          </p>
        ) : loading ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Se încarcă ofertele...
          </div>
        ) : normalizedOffers.length === 0 && !focusedRejectedOffer ? (
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
        ) : displayedOffers.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/70">
            Nu ai oferte pentru această categorie.
          </div>
        ) : (
          <div className="space-y-6">
            {displayedOffers.map((offer) => {
              const request = offer.repair_requests;
              const requestMetrics = request?.id
                ? metricsByRequestId.get(request.id)
                : null;
              const appointment = offer.repair_appointments?.[0];
              const isRejectedFocus = offer.status === "rejected";
              const isClosedRequestFocus =
                isRejectedFocus && request?.status === "closed";
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
              const wheelsSummary =
                request?.service_type === "wheels"
                  ? getWheelsDisplaySummary(request.service_details)
                  : undefined;
              const routeEstimate =
                request?.service_type === "towing" &&
                isNonNegativeFinite(request.route_distance_meters) &&
                isNonNegativeFinite(request.route_duration_seconds)
                  ? {
                      distanceMeters: request.route_distance_meters,
                      durationSeconds: request.route_duration_seconds,
                    }
                  : null;
              const towingSummary =
                request?.service_type === "towing"
                  ? getTowingDisplaySummary(request.service_details, routeEstimate)
                  : undefined;
              const towingPickup =
                isFiniteCoordinate(request?.pickup_lat, -90, 90) &&
                isFiniteCoordinate(request?.pickup_lng, -180, 180)
                  ? { lat: request.pickup_lat, lng: request.pickup_lng }
                  : null;
              const towingDestination =
                isFiniteCoordinate(request?.destination_lat, -90, 90) &&
                isFiniteCoordinate(request?.destination_lng, -180, 180)
                  ? {
                      lat: request.destination_lat,
                      lng: request.destination_lng,
                    }
                  : null;
              const displayedDamageTypeLabels =
                detailedDamageTypeLabels.length > 0
                  ? detailedDamageTypeLabels
                  : fallbackDamageTypeLabel
                    ? [fallbackDamageTypeLabel]
                    : [];

              const workshopBadge = isRejectedFocus
                ? {
                    text: isClosedRequestFocus
                      ? "CERERE ÎNCHISĂ"
                      : "OFERTĂ REFUZATĂ",
                    color: "red" as const,
                  }
                : appointment?.status === "confirmed"
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

              if (!request) {
                return (
                  <article key={offer.id} className="rounded-[28px] bg-white p-5 text-black shadow-lg">
                    <p role="status">Detaliile cererii nu sunt disponibile momentan. Nu putem deschide Chat sau modifica data pentru această ofertă.</p>
                    <OfferSummaryCard
                      price={offer.price}
                      days={offer.days}
                      appointmentDate={displayDate}
                      appointmentTime={displayTime}
                      handoverText={appointment?.handover_method === "workshop_pickup"
                        ? "Service-ul ridică mașina" : "Clientul aduce mașina"}
                      statusText={isRejectedFocus ? "Ofertă refuzată"
                        : appointment?.status === "customer_proposed" ? "Clientul a propus altă dată"
                        : appointment?.status === "workshop_proposed" ? "Așteaptă confirmarea clientului"
                        : "Așteaptă confirmare"}
                      title="Oferta service-ului"
                    />
                    {offer.message && <p className="mt-3">{offer.message}</p>}
                  </article>
                );
              }

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
                    separateLocation
                    platePosition="bottom"
                    affectedParts={affectedPartLabels}
                    damageTypes={
                      mechanicalDetails.length > 0 ||
                      wheelsSummary ||
                      towingSummary
                        ? []
                        : displayedDamageTypeLabels
                    }
                    mechanicalDetails={mechanicalDetails}
                    wheelsSummary={wheelsSummary}
                    towingSummary={towingSummary}
                    details={[
                      workshopBadge,
                      {
                        text: getRequestTypeBadgeLabel(request?.service_type),
                        color: "orange",
                      },
                    ]}
                  />

                  <RepairRequestMetrics
                    viewCount={requestMetrics?.viewCount ?? 0}
                    offerCount={requestMetrics?.offerCount ?? 0}
                  />

                  <RequestClientName name={request?.clientName} />

                  {isRejectedFocus && (
                    <div className="mt-4 rounded-[24px] border border-red-200 bg-red-50 p-5">
                      <p className="text-sm font-semibold leading-6 text-red-800">
                        {isClosedRequestFocus
                          ? "Clientul a închis cererea."
                          : "Clientul a ales un alt service pentru această lucrare."}
                      </p>
                    </div>
                  )}

                  {request?.service_type === "towing" && (
                    <TowingScheduleCard
                      scheduleType={request.towing_schedule_type}
                      requestedAt={request.towing_requested_at}
                      requestedTimezone={request.towing_requested_timezone}
                      className="mt-4 p-4"
                    />
                  )}

                  {routeEstimate && (
                    <div className="mt-4 [&>section]:mb-0">
                      <TowingRouteEstimateCard
                        distanceMeters={routeEstimate.distanceMeters}
                        durationSeconds={routeEstimate.durationSeconds}
                        pickup={towingPickup}
                        destination={towingDestination}
                        paths={request?.route_paths ?? null}
                      />
                    </div>
                  )}

                  <OfferSummaryCard
                    price={offer.price}
                    days={
                      request?.service_type === "towing" ? null : offer.days
                    }
                    appointmentDate={displayDate}
                    appointmentTime={displayTime}
                    handoverText={
                      appointment?.handover_method === "workshop_pickup"
                        ? "Service-ul ridică mașina"
                        : "Clientul aduce mașina"
                    }
                    statusText={
                      isRejectedFocus
                        ? isClosedRequestFocus
                          ? "Cerere închisă"
                          : "Ofertă refuzată"
                        : appointment?.status === "customer_proposed"
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

                  {!isRejectedFocus && (
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
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function isNonNegativeFinite(
  value: number | null | undefined,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteCoordinate(
  value: number | null | undefined,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}
