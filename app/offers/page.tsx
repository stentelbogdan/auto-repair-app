"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { getOwnRepairRequests } from "@/lib/supabase/repair-requests";
import CarHeader from "@/app/components/CarHeader";
import { CalendarDays, Check, MessageCircle } from "lucide-react";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import WorkshopSummaryCard from "@/app/components/WorkshopSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";

type RepairRequest = {
  id: string;
  licensePlate?: string | null;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  description: string;
  images: {
    name: string;
    url?: string;
    dataUrl?: string;
  }[];
  status?: string;
  acceptedOfferId?: string | null;
};

type RepairOffer = {
  id: string;
  requestId: string;
  workshopUserId: string;
  workshopSlug: string | null;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  createdAt: string;
  status?: string;
  workshopLogoUrl: string | null;
  availableDate: string | null;
  availableTime: string | null;
};

type AppointmentStatus =
  | "workshop_proposed"
  | "customer_proposed"
  | "requested"
  | "confirmed"
  | "declined"
  | "cancelled";

type RepairAppointment = {
  id: string;
  requestId: string;
  offerId: string | null;
  status: AppointmentStatus | null;
  appointmentDate: string | null;
  appointmentTime: string | null;
  proposedDate: string | null;
  proposedTime: string | null;
};

type WorkshopRating = {
  average: number;
  count: number;
  lastReview?: string;
  completedJobs?: number;
  specialties?: string[];
};

type OfferWithRequest = {
  offer: RepairOffer;
  request: RepairRequest;
  appointment: RepairAppointment | null;
};

type ProfileRow = {
  role: string[] | null;
};

export default function OffersPage() {
  const router = useRouter();

  const [items, setItems] = useState<OfferWithRequest[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);
  const [, setWorkshopRatings] = useState<Record<string, WorkshopRating>>({});

  useEffect(() => {
    const resetScroll = () => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    };

    resetScroll();

    const frame = window.requestAnimationFrame(resetScroll);
    const timeout = window.setTimeout(resetScroll, 120);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const checkUserAndLoad = async () => {
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

        if (!roles.includes("customer")) {
          router.push("/workshops/my-offers");
          return;
        }

        setAuthorized(true);
        await loadData(authData.user.id);
      } catch {
        router.push("/login");
      } finally {
        setCheckingAccess(false);
      }
    };

    checkUserAndLoad();
  }, [router]);

  const loadData = async (userId?: string) => {
    setLoadingOffers(true);

    try {
      let currentUserId = userId;

      if (!currentUserId) {
        const { data: authData } = await supabase.auth.getUser();
        currentUserId = authData.user?.id;

        if (!currentUserId) {
          setItems([]);
          return;
        }
      }

      const requestRows = await getOwnRepairRequests(currentUserId);

      const activeRequests = requestRows.filter((request) => {
        const status = request.status || "open";
        return status !== "completed";
      });

      const requestIds = activeRequests.map((request) => request.id);

      if (requestIds.length === 0) {
        setItems([]);
        return;
      }

      const { data: offerRows, error } = await supabase
        .from("repair_offers")
        .select("*")
        .in("request_id", requestIds)
        .eq("status", "pending")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to load offers:", error);
        setItems([]);
        return;
      }

      const offerIds = (offerRows || []).map((offer) => offer.id);

      let appointmentMap = new Map<string, RepairAppointment>();

      if (offerIds.length > 0) {
        const { data: appointmentRows, error: appointmentError } =
          await supabase
            .from("repair_appointments")
            .select(
              `
      id,
      request_id,
      offer_id,
      status,
      appointment_date,
      appointment_time,
      proposed_date,
      proposed_time
    `,
            )
            .in("offer_id", offerIds);

        if (appointmentError) {
          console.error(
            "Failed to load repair appointments:",
            appointmentError,
          );
        } else {
          appointmentMap = new Map<string, RepairAppointment>();

          (appointmentRows || []).forEach((appointment) => {
            if (!appointment.offer_id) return;

            appointmentMap.set(appointment.offer_id, {
              id: appointment.id,
              requestId: appointment.request_id,
              offerId: appointment.offer_id,
              status: appointment.status
                ? (appointment.status as AppointmentStatus)
                : null,
              appointmentDate: appointment.appointment_date || null,
              appointmentTime: appointment.appointment_time || null,
              proposedDate: appointment.proposed_date || null,
              proposedTime: appointment.proposed_time || null,
            });
          });
        }
      }

      const unreadOfferIds = (offerRows || [])
        .filter((offer) => !offer.customer_read_at)
        .map((offer) => offer.id);

      if (unreadOfferIds.length > 0) {
        await supabase
          .from("repair_offers")
          .update({ customer_read_at: new Date().toISOString() })
          .in("id", unreadOfferIds);

        window.dispatchEvent(new Event("offers-read-updated"));
      }

      const workshopUserIds = Array.from(
        new Set(
          (offerRows || [])
            .map((offer) => offer.workshop_user_id)
            .filter(Boolean),
        ),
      );

      const ratingsMap: Record<string, WorkshopRating> = {};

      if (workshopUserIds.length > 0) {
        const { data: reviewsData } = await supabase
          .from("reviews")
          .select("workshop_user_id, rating, comment, created_at")
          .in("workshop_user_id", workshopUserIds);

        (reviewsData || []).forEach((review: any) => {
          const workshopId = review.workshop_user_id;
          const ratingValue = Number(review.rating || 0);

          if (!workshopId || ratingValue <= 0) return;

          if (!ratingsMap[workshopId]) {
            ratingsMap[workshopId] = {
              average: 0,
              count: 0,
              lastReview: "",
              completedJobs: 0,
              specialties: [],
            };
          }

          ratingsMap[workshopId].average += ratingValue;
          ratingsMap[workshopId].count += 1;

          if (!ratingsMap[workshopId].lastReview && review.comment) {
            ratingsMap[workshopId].lastReview = review.comment;
          }
        });

        Object.keys(ratingsMap).forEach((workshopId) => {
          ratingsMap[workshopId].average =
            ratingsMap[workshopId].average / ratingsMap[workshopId].count;
        });
      }

      const { data: completedRequests } = await supabase
        .from("repair_requests")
        .select("accepted_offer_id, damage_type, service_type")
        .eq("status", "completed")
        .not("accepted_offer_id", "is", null);

      const completedOfferIds = (completedRequests || [])
        .map((request) => request.accepted_offer_id)
        .filter(Boolean);

      if (completedOfferIds.length > 0) {
        const { data: completedOffers } = await supabase
          .from("repair_offers")
          .select("id, workshop_user_id")
          .in("id", completedOfferIds);

        (completedOffers || []).forEach((offer) => {
          const completedRequest = (completedRequests || []).find(
            (request) => request.accepted_offer_id === offer.id,
          );
          const workshopId = offer.workshop_user_id;
          if (!workshopId) return;

          if (!ratingsMap[workshopId]) {
            ratingsMap[workshopId] = {
              average: 0,
              count: 0,
              lastReview: "",
              completedJobs: 0,
              specialties: [],
            };
          }

          ratingsMap[workshopId].completedJobs =
            (ratingsMap[workshopId].completedJobs || 0) + 1;

          const specialty =
            completedRequest?.damage_type || completedRequest?.service_type;

          if (
            specialty &&
            !ratingsMap[workshopId].specialties?.includes(specialty)
          ) {
            ratingsMap[workshopId].specialties?.push(specialty);
          }
        });
      }

      let workshopProfileMap = new Map<
        string,
        {
          workshop_slug: string | null;
          workshop_name: string | null;
          workshop_logo_url: string | null;
        }
      >();

      if (workshopUserIds.length > 0) {
        const { data: workshopProfiles } = await supabase
          .from("profiles")
          .select("id, workshop_slug, workshop_name, workshop_logo_url")
          .in("id", workshopUserIds);

        workshopProfileMap = new Map(
          (workshopProfiles || []).map((profile) => [
            profile.id,
            {
              workshop_slug: profile.workshop_slug || null,
              workshop_name: profile.workshop_name || null,
              workshop_logo_url: profile.workshop_logo_url || null,
            },
          ]),
        );
      }

      const requestMap = new Map<string, RepairRequest>();

      activeRequests.forEach((request) => {
        requestMap.set(request.id, {
          id: request.id,
          licensePlate: request.license_plate,
          carBrand: request.car_brand,
          carModel: request.car_model,
          carYear: request.car_year,
          city: request.city,
          damageType: request.damage_type,
          description: request.description || "",
          images: Array.isArray(request.images) ? request.images : [],
          status: request.status,
          acceptedOfferId: request.accepted_offer_id,
        });
      });

      const merged: OfferWithRequest[] = [];

      (offerRows || []).forEach((offer) => {
        const matchingRequest = requestMap.get(offer.request_id);
        if (!matchingRequest) return;

        const workshopProfile = workshopProfileMap.get(offer.workshop_user_id);

        merged.push({
          offer: {
            id: offer.id,
            requestId: offer.request_id,
            workshopUserId: offer.workshop_user_id,
            workshopSlug: workshopProfile?.workshop_slug || null,
            price: String(offer.price),
            days: String(offer.days),
            message: offer.message || "",
            workshopName:
              workshopProfile?.workshop_name ||
              offer.workshop_name ||
              "Service",
            createdAt: offer.created_at,
            status: offer.status,
            workshopLogoUrl: workshopProfile?.workshop_logo_url || null,
            availableDate: offer.available_date || null,
            availableTime: offer.available_time || null,
          },
          request: matchingRequest,
          appointment: appointmentMap.get(offer.id) || null,
        });
      });

      setWorkshopRatings(ratingsMap);
      setItems(merged);
    } catch (error) {
      console.error("Failed to load customer offers:", error);
      setItems([]);
    } finally {
      setLoadingOffers(false);
    }
  };

  const handleConfirmAppointment = async (offerId: string) => {
    try {
      setAcceptingOfferId(offerId);

      // aici vom implementa confirmarea programării
    } catch (error) {
      console.error(error);
      alert("Nu am putut confirma programarea.");
    } finally {
      setAcceptingOfferId(null);
    }
  };

  const formatDamageType = (value?: string) => {
    if (!value) return "Daună";

    const labels: Record<string, string> = {
      cosmetic: "Daună estetică",
      mechanical: "Daună mecanică",
      detailing: "Detailing",
      body: "Caroserie",
      bodywork: "Caroserie",

      scratch: "Zgârietură",
      dent: "Îndoitură",
      crack: "Fisură",
      paint: "Vopsire",
      bumper: "Bară",
      hood: "Capotă",

      detailing_interior: "Detailing interior",
      detailing_exterior: "Detailing exterior",
      polish: "Polish profesional",
      ceramic: "Protecție ceramică",
      ppf: "Folie PPF",
      wrapping: "Colantare",
      window_tint: "Folii geamuri",
      dechroming: "Dechroming",
      wheel_refurbishment: "Recondiționare jante",
      smart_repair: "Smart Repair",
      pdr: "Îndreptare fără vopsire",
    };

    return labels[value] || value;
  };

  if (checkingAccess) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se verifică accesul...
      </main>
    );
  }

  if (!authorized) return null;

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white md:px-6 md:py-10">
      <div className="mx-auto max-w-5xl space-y-4">
        {loadingOffers ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/60">
            Se încarcă ofertele...
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center">
            <h2 className="text-2xl font-bold">Nu ai oferte în așteptare</h2>
            <p className="mt-3 text-white/60">
              Ofertele acceptate apar în Programări.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {items.map(({ offer, request, appointment }) => {
              const appointmentStatus = appointment?.status;

              const isCustomerProposed =
                appointmentStatus === "customer_proposed";

              const isWorkshopProposed =
                appointmentStatus === "workshop_proposed" ||
                appointmentStatus === "requested";

              const displayedAppointmentDate =
                appointment?.proposedDate ||
                appointment?.appointmentDate ||
                offer.availableDate;

              const displayedAppointmentTime =
                appointment?.proposedTime ||
                appointment?.appointmentTime ||
                offer.availableTime;

              const appointmentStatusText = isCustomerProposed
                ? "Așteaptă confirmarea service-ului"
                : isWorkshopProposed
                  ? "Așteaptă confirmarea ta"
                  : "Așteaptă confirmare";

              return (
                <div
                  key={offer.id}
                  className="rounded-[28px] bg-white p-5 text-black shadow-lg"
                >
                  <CarHeader
                    images={request.images}
                    plate={request.licensePlate}
                    platePosition="bottom"
                    brand={request.carBrand}
                    model={request.carModel}
                    year={request.carYear}
                    city={request.city}
                    variant="listLarge"
                    details={[
                      {
                        text: "Necesită programare",
                        color: "orange",
                      },
                      {
                        text: formatDamageType(request.damageType),
                        color: "yellow",
                      },
                    ]}
                  />

                  <WorkshopSummaryCard
                    workshopUserId={offer.workshopUserId}
                    workshopName={offer.workshopName}
                    workshopLogoUrl={offer.workshopLogoUrl}
                    workshopSlug={offer.workshopSlug}
                    onClick={() => {
                      if (!offer.workshopSlug) {
                        alert("Profilul service-ului nu este disponibil.");
                        return;
                      }

                      router.push(`/workshops/profile/${offer.workshopSlug}`);
                    }}
                  />

                  <OfferSummaryCard
                    title="Oferta service-ului"
                    price={offer.price}
                    days={offer.days}
                    appointmentDate={displayedAppointmentDate}
                    appointmentTime={displayedAppointmentTime}
                    handoverText="Predare la service"
                    statusText={appointmentStatusText}
                  />

                  {offer.message && (
                    <div className="mt-3 rounded-2xl bg-gray-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-black/60">
                        Mesaj service
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-black/90">
                        {offer.message}
                      </p>
                    </div>
                  )}
                  <p className="mt-5 text-center text-[13px] font-medium text-black/60">
                    {isCustomerProposed
                      ? "Așteaptă confirmarea service-ului."
                      : "Confirmă programarea sau modifică data propusă."}
                  </p>

                  <div
                    className={`mt-4 grid gap-3 ${
                      isCustomerProposed ? "grid-cols-2" : "grid-cols-3"
                    }`}
                  >
                    {!isCustomerProposed && (
                      <button
                        type="button"
                        onClick={() => handleConfirmAppointment(offer.id)}
                        disabled={acceptingOfferId === offer.id}
                        className="rounded-2xl bg-black px-4 py-4 text-sm font-bold text-white transition hover:bg-black/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {acceptingOfferId === offer.id ? (
                          "Se confirmă..."
                        ) : (
                          <span className="flex items-center justify-center gap-1.5">
                            <Check size={18} strokeWidth={2.5} />
                            <span>Confirmă programarea</span>
                          </span>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/chat/${request.id}?offerId=${offer.id}`)
                      }
                      className="rounded-2xl bg-black px-4 py-4 text-sm font-bold text-white transition hover:bg-black/90 active:scale-[0.98]"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <MessageCircle size={18} strokeWidth={2.3} />
                        <span>Chat</span>
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        router.push(
                          `/customer/schedule-damage/${request.id}?offerId=${offer.id}&from=customer`,
                        )
                      }
                      className="rounded-2xl bg-black px-4 py-4 text-sm font-bold text-white transition hover:bg-black/90 active:scale-[0.98]"
                    >
                      <span className="flex items-center justify-center gap-1.5">
                        <CalendarDays size={18} strokeWidth={2.3} />
                        <span>Modifică data</span>
                      </span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
