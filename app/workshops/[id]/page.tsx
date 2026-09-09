"use client";

import { FormEvent, useEffect, useEffectEvent, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import CarHeader from "@/app/components/CarHeader";
import AppointmentSummaryCard from "@/app/components/AppointmentSummaryCard";
import TowingRouteEstimateCard from "@/app/components/towing/TowingRouteEstimateCard";
import { createRepairOffer } from "@/lib/supabase/repair-offers";
import type {
  RepairServiceDetails,
  TowingScheduleType,
} from "@/lib/supabase/repair-requests";
import { getAffectedPartLabels, getDamageTypeLabels } from "@/lib/car-damage";
import { getRequestTypeBadgeLabel } from "@/lib/displayLabels";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { recordWorkshopRequestView } from "@/lib/supabase/repair-request-views";
import { getWorkshopRequestClientNames } from "@/lib/supabase/workshop-client-names";
import RequestClientName from "@/app/components/RequestClientName";
import type { RepairServiceType } from "@/lib/repair-requests/service-types";
import {
  formatTowingRouteDuration,
  getTowingDisplaySummary,
} from "@/lib/towing/towing-display";
import { getTowingScheduleDisplay } from "@/lib/towing/towing-schedule-display";
import { isTowingServiceDetailsV1 } from "@/lib/towing/towing-service-details";
import type { TowingRoutePaths } from "@/lib/towing/towing-route";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";

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
  service_details: RepairServiceDetails | null;
  service_type: RepairServiceType | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  destination_lat: number | null;
  destination_lng: number | null;
  route_distance_meters: number | null;
  route_duration_seconds: number | null;
  route_paths: TowingRoutePaths | null;
  towing_schedule_type: TowingScheduleType | null;
  towing_requested_at: string | null;
  towing_requested_timezone: string | null;
  description: string | null;
  images: RepairImage[];
  status: string;
};

export default function WorkshopRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const searchParams = useSearchParams();
  const dateFromUrl = searchParams.get("date");
  const timeFromUrl = searchParams.get("time");

  const [request, setRequest] = useState<RepairRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState("");

  const [availableDate, setAvailableDate] = useState("");
  const [availableTime, setAvailableTime] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasExistingOffer, setHasExistingOffer] = useState(false);
  const [clientName, setClientName] = useState<string | null>(null);

  const loadRequest = useEffectEvent(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setLoading(true);
      }

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
            "id, car_brand, car_model, car_year, city, license_plate, damage_type, service_details, service_type, pickup_lat, pickup_lng, destination_lat, destination_lng, route_distance_meters, route_duration_seconds, route_paths, towing_schedule_type, towing_requested_at, towing_requested_timezone, description, images, status",
          )
          .eq("id", id)
          .single<RepairRequestRow>();

        if (error || !data) {
          if (!silent) {
            setRequest(null);
          } else if (process.env.NODE_ENV === "development") {
            console.error("Silent repair request refresh failed.", error);
          }
          return;
        }

        setRequest(data);
        void recordWorkshopRequestView(data.id);

        const clientNamesByRequestId = await getWorkshopRequestClientNames([
          data.id,
        ]);
        setClientName(clientNamesByRequestId.get(data.id) ?? null);

        const { data: existingOffer, error: existingOfferError } =
          await supabase
            .from("repair_offers")
            .select("id")
            .eq("request_id", data.id)
            .eq("workshop_user_id", authData.user.id)
            .limit(1)
            .maybeSingle();

        if (existingOfferError) {
          throw existingOfferError;
        }

        const offerExists = Boolean(existingOffer);
        setHasExistingOffer(offerExists);

        if (offerExists) {
          sessionStorage.removeItem(`availability-${data.id}`);
        }
      } catch (error) {
        if (!silent) {
          setRequest(null);
        } else if (process.env.NODE_ENV === "development") {
          console.error("Silent repair request refresh failed.", error);
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
  );

  useEffect(() => {
    localStorage.setItem("activeRole", "workshop");

    const savedAvailability = sessionStorage.getItem(`availability-${id}`);

    if (savedAvailability) {
      const parsed = JSON.parse(savedAvailability);

      setAvailableDate(parsed.date || dateFromUrl || "");
      setAvailableTime(parsed.time || timeFromUrl || "");
      setPrice(parsed.price || "");
      setDays(parsed.days || "");
      setMessage(parsed.message || "");
    } else {
      setAvailableDate(dateFromUrl || "");
      setAvailableTime(timeFromUrl || "");
    }

    void loadRequest();
  }, [id, router]);

  useEffect(() => {
    let hasSubscribed = false;

    const channel = supabase
      .channel(`workshop-request-details-${id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "repair_requests",
          filter: `id=eq.${id}`,
        },
        () => {
          void loadRequest({ silent: true });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hasSubscribed) {
            void loadRequest({ silent: true });
          }

          hasSubscribed = true;
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting || !request) return;

    const finalAvailableDate = availableDate;
    const finalAvailableTime = availableTime;
    const finalDays =
      request.service_type === "towing"
        ? isNonNegativeFinite(request.route_duration_seconds)
          ? formatTowingRouteDuration(request.route_duration_seconds)
          : "Durată transport nespecificată"
        : days;

    if (!price || !finalDays || !finalAvailableDate || !finalAvailableTime) {
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

      const savedAvailability = sessionStorage.getItem(`availability-${id}`);

      const parsedAvailability = savedAvailability
        ? JSON.parse(savedAvailability)
        : {};
      const defaultHandoverMethod =
        request.service_type === "towing"
          ? "workshop_pickup"
          : "customer_dropoff";
      const towingDetails = isTowingServiceDetailsV1(request.service_details)
        ? request.service_details
        : null;

      if (request.service_type === "towing" && !towingDetails) {
        throw new Error("Adresa de preluare a cererii Towing nu este disponibilă.");
      }

      await createRepairOffer({
        requestId: id,
        workshopUserId: authData.user.id,
        price,
        days: finalDays,
        message,
        workshopName,
        availableDate: finalAvailableDate,
        availableTime: finalAvailableTime,
        handoverMethod:
          request.service_type === "towing"
            ? "workshop_pickup"
            : parsedAvailability.handoverMethod || defaultHandoverMethod,
        pickupAddress:
          request.service_type === "towing" && towingDetails
            ? `${towingDetails.pickup.address}, ${towingDetails.pickup.city}`
            : parsedAvailability.pickupAddress || "",
      });

      sessionStorage.removeItem(`availability-${id}`);

      router.replace("/workshops/dashboard?offerSent=1");
    } catch (error: unknown) {
      alert(
        error instanceof Error
          ? error.message
          : "Nu am putut trimite oferta.",
      );
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

  if (hasExistingOffer) {
    return (
      <main className="min-h-screen bg-black px-4 py-8 text-white">
        <div className="mx-auto max-w-md">
          <div className="rounded-[28px] bg-white p-6 text-center text-black shadow-xl">
            <h1 className="text-2xl font-bold">Ai trimis deja o ofertă</h1>

            <p className="mt-2 text-sm text-black/55">
              Pentru această lucrare există deja o ofertă trimisă de service-ul
              tău. Așteaptă răspunsul clientului.
            </p>

            <button
              type="button"
              onClick={() => router.push("/workshops/my-offers")}
              className="mt-6 rounded-full bg-black px-6 py-3 text-sm font-semibold text-white"
            >
              Vezi ofertele tale
            </button>
          </div>
        </div>
      </main>
    );
  }

  const isClosed = request.status === "completed";

  const affectedPartLabels = getAffectedPartLabels(request.service_details);

  const damageTypeLabels = getDamageTypeLabels(request.service_details);

  const mechanicalDetails =
    request.service_type === "mechanical"
      ? getMechanicalServiceDetailGroups(request.service_details)
      : [];

  const wheelsSummary =
    request.service_type === "wheels"
      ? getWheelsDisplaySummary(request.service_details)
      : undefined;

  const routeEstimate =
    request.service_type === "towing" &&
    isNonNegativeFinite(request.route_distance_meters) &&
    isNonNegativeFinite(request.route_duration_seconds)
      ? {
          distanceMeters: request.route_distance_meters,
          durationSeconds: request.route_duration_seconds,
        }
      : null;
  const towingSummary =
    request.service_type === "towing"
      ? getTowingDisplaySummary(request.service_details, routeEstimate)
      : undefined;
  const towingPickup =
    isFiniteCoordinate(request.pickup_lat, -90, 90) &&
    isFiniteCoordinate(request.pickup_lng, -180, 180)
      ? { lat: request.pickup_lat, lng: request.pickup_lng }
      : null;
  const towingDestination =
    isFiniteCoordinate(request.destination_lat, -90, 90) &&
    isFiniteCoordinate(request.destination_lng, -180, 180)
      ? { lat: request.destination_lat, lng: request.destination_lng }
      : null;
  const towingScheduleDisplay =
    request.service_type === "towing"
      ? getTowingScheduleDisplay(
          request.towing_schedule_type,
          request.towing_requested_at,
          request.towing_requested_timezone,
        )
      : null;

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
            affectedParts={affectedPartLabels}
            damageTypes={damageTypeLabels}
            mechanicalDetails={mechanicalDetails}
            showAllMechanicalDetails
            wheelsSummary={wheelsSummary}
            towingSummary={towingSummary}
            details={[
              {
                text: isClosed ? "Închisă" : "Deschisă",
                color: isClosed ? "red" : "yellow",
              },
              {
                text: getRequestTypeBadgeLabel(request.service_type),
                color: "orange",
              },
            ]}
          />

          <RequestClientName name={clientName} variant="detail" />

          {towingScheduleDisplay && (
            <div className="mt-4 rounded-2xl border border-black/10 bg-black/[0.03] p-4">
              <p className="text-[13px] font-bold uppercase tracking-wide text-orange-600">
                Solicitare transport
              </p>
              <p className="mt-1 text-sm font-bold text-black/75">
                {towingScheduleDisplay}
              </p>
            </div>
          )}

          {routeEstimate && (
            <div className="mt-4 [&>section]:mb-0">
              <TowingRouteEstimateCard
                distanceMeters={routeEstimate.distanceMeters}
                durationSeconds={routeEstimate.durationSeconds}
                pickup={towingPickup}
                destination={towingDestination}
                paths={request.route_paths}
              />
            </div>
          )}

          <div
            className={`${routeEstimate ? "mt-4" : "mt-5"} rounded-2xl border border-black/10 bg-black/[0.03] p-4`}
          >
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

          {request.service_type !== "towing" && (
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
          )}

          <AppointmentSummaryCard
            date={availableDate}
            time={availableTime}
            editable
            onClick={() => {
              sessionStorage.setItem(
                `availability-${request.id}`,
                JSON.stringify({
                  date: availableDate,
                  time: availableTime,
                  price,
                  days:
                    request.service_type === "towing"
                      ? isNonNegativeFinite(request.route_duration_seconds)
                        ? formatTowingRouteDuration(
                            request.route_duration_seconds,
                          )
                        : "Durată transport nespecificată"
                      : days,
                  message,
                }),
              );

              router.push(
                `/customer/schedule-damage/${request.id}?from=workshop&mode=initial-offer`,
              );
            }}
            className="mt-5"
          />

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

function isNonNegativeFinite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteCoordinate(
  value: number | null,
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
