"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { acceptRepairOffer } from "@/lib/supabase/repair-offers";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import WorkshopSummaryCard from "@/app/components/WorkshopSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";
import { markNotificationsAsRead } from "@/lib/notifications";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import type { CustomerOfferItem } from "@/lib/services/offers/customer-offers.types";
import { loadCustomerOffers } from "@/lib/services/offers/customer-offers.service";

type ProfileRow = {
  role: string[] | null;
};

export default function OffersPage() {
  /*
   * Routerul rămâne doar pentru redirecturile automate:
   * login și acces pe rolul greșit.
   */
  const router = useRouter();

  /*
   * Navigările provocate de utilizator trec prin hook-ul comun.
   */
  const { navigate, runLocked, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const [items, setItems] = useState<CustomerOfferItem[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

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
    if (!authorized) {
      return;
    }

    void markNotificationsAsRead({
      recipientRole: "customer",
      types: [
        "workshop_proposed_appointment",
        "offer_received",
        "appointment_confirmed",
      ],
    });
  }, [authorized]);

  useEffect(() => {
    let cancelled = false;

    const checkUserAndLoad = async () => {
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

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (cancelled) {
          return;
        }

        if (profileError) {
          throw profileError;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("customer")) {
          router.replace("/workshops/my-offers");
          return;
        }

        setAuthorized(true);
        setLoadingOffers(true);

        const result = await loadCustomerOffers(authData.user.id);

        if (cancelled) {
          return;
        }

        setItems(result.items);

        if (result.markedOffersAsRead) {
          window.dispatchEvent(new Event("offers-read-updated"));
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to check or load customer offers:", error);

        /*
         * Dacă sesiunea există, dar încărcarea ofertelor eșuează,
         * nu trimitem automat utilizatorul la login.
         */
        setItems([]);
      } finally {
        if (!cancelled) {
          setLoadingOffers(false);
          setCheckingAccess(false);
        }
      }
    };

    void checkUserAndLoad();

    return () => {
      cancelled = true;
    };
  }, [router]);

  const openWorkshopProfile = (workshopSlug: string | null) => {
    if (!workshopSlug) {
      window.alert("Profilul service-ului nu este disponibil.");
      return;
    }

    navigate(`/workshops/profile/${workshopSlug}`);
  };

  const handleConfirmAppointment = (offerId: string) => {
    if (acceptingOfferId || isNavigating) {
      return;
    }

    void runLocked(async ({ navigate }) => {
      try {
        setAcceptingOfferId(offerId);

        const selectedItem = items.find((item) => item.offer.id === offerId);

        if (!selectedItem) {
          throw new Error("Oferta nu a fost găsită în lista curentă.");
        }

        const { offer, request, appointment } = selectedItem;

        if (!appointment?.id) {
          throw new Error(
            "Programarea asociată acestei oferte nu a fost găsită.",
          );
        }

        if (
          appointment.status !== "workshop_proposed" &&
          appointment.status !== "requested"
        ) {
          throw new Error(
            "Această programare nu mai poate fi confirmată de client.",
          );
        }

        const confirmedDate =
          appointment.proposedDate ||
          appointment.appointmentDate ||
          offer.availableDate;

        const confirmedTime =
          appointment.proposedTime ||
          appointment.appointmentTime ||
          offer.availableTime;

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

        navigate("/customer/dashboard");
      } catch (error) {
        console.error("Failed to confirm appointment:", error);

        const message =
          error instanceof Error
            ? error.message
            : "Nu am putut confirma programarea.";

        window.alert(message);
      } finally {
        setAcceptingOfferId(null);
      }
    });
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

              const customerBadge =
                appointmentStatus === "confirmed"
                  ? {
                      text: "Programare confirmată",
                      color: "green" as const,
                    }
                  : appointmentStatus === "customer_proposed"
                    ? {
                        text: "În așteptare",
                        color: "yellow" as const,
                      }
                    : appointmentStatus === "workshop_proposed"
                      ? {
                          text: "Service-ul a propus altă dată",
                          color: "orange" as const,
                        }
                      : {
                          text: "Necesită programare",
                          color: "orange" as const,
                        };

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
                      customerBadge,
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
                    onClick={() => openWorkshopProfile(offer.workshopSlug)}
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

                  <AppointmentActions
                    showConfirm={!isCustomerProposed}
                    confirming={acceptingOfferId === offer.id}
                    confirmDisabled={acceptingOfferId !== null || isNavigating}
                    onConfirm={() => handleConfirmAppointment(offer.id)}
                    onChat={() =>
                      navigate(`/chat/${request.id}?offerId=${offer.id}`)
                    }
                    onChangeDate={() =>
                      navigate(
                        `/customer/schedule-damage/${request.id}?offerId=${offer.id}&from=customer`,
                      )
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
