"use client";

import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import CarHeader from "@/app/components/CarHeader";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import WorkshopSummaryCard from "@/app/components/WorkshopSummaryCard";
import AppointmentActions from "@/app/components/AppointmentActions";
import { markNotificationsAsRead } from "@/lib/notifications";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import type {
  CustomerOfferItem,
  CustomerOfferRepairRequest,
} from "@/lib/services/offers/customer-offers.types";
import { loadCustomerOffers } from "@/lib/services/offers/customer-offers.service";
import { confirmCustomerAppointment } from "@/lib/services/offers/customer-appointments.service";
import { getDamageTypeLabel } from "@/lib/displayLabels";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
} from "@/lib/car-damage";

type ProfileRow = {
  role: string[] | null;
};

type OfferGroup = {
  request: CustomerOfferRepairRequest;
  items: CustomerOfferItem[];
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
  const [activeOfferIdByRequestId, setActiveOfferIdByRequestId] = useState<
    Record<string, string>
  >({});
  const carouselRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const offerGroups = useMemo(() => {
    const groups = new Map<string, OfferGroup>();

    items.forEach((item) => {
      const requestId = item.request.id;
      const existingGroup = groups.get(requestId);

      if (existingGroup) {
        existingGroup.items.push(item);
        return;
      }

      groups.set(requestId, {
        request: item.request,
        items: [item],
      });
    });

    return Array.from(groups.values());
  }, [items]);

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

  const setActiveOffer = (requestId: string, offerId: string) => {
    setActiveOfferIdByRequestId((current) => {
      if (current[requestId] === offerId) {
        return current;
      }

      return {
        ...current,
        [requestId]: offerId,
      };
    });
  };

  const handleCarouselScroll = (
    requestId: string,
    groupItems: CustomerOfferItem[],
    event: UIEvent<HTMLDivElement>,
  ) => {
    const carousel = event.currentTarget;

    if (carousel.clientWidth === 0) {
      return;
    }

    const nextIndex = Math.min(
      groupItems.length - 1,
      Math.max(0, Math.round(carousel.scrollLeft / carousel.clientWidth)),
    );
    const nextOffer = groupItems[nextIndex];

    if (nextOffer) {
      setActiveOffer(requestId, nextOffer.offer.id);
    }
  };

  const moveCarousel = (
    requestId: string,
    groupItems: CustomerOfferItem[],
    activeIndex: number,
    direction: -1 | 1,
  ) => {
    const nextIndex = Math.min(
      groupItems.length - 1,
      Math.max(0, activeIndex + direction),
    );
    const nextOffer = groupItems[nextIndex];
    const carousel = carouselRefs.current[requestId];

    if (!nextOffer || !carousel) {
      return;
    }

    setActiveOffer(requestId, nextOffer.offer.id);
    carousel.scrollTo({
      left: nextIndex * carousel.clientWidth,
      behavior: "smooth",
    });
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

        await confirmCustomerAppointment({
          item: selectedItem,
        });

        /*
         * Aceste evenimente țin de UI și rămân în pagină.
         * Serviciul nu trebuie să depindă de window sau Next.js.
         */
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
            {offerGroups.map((group) => {
              const { request } = group;
              const configuredActiveOfferId =
                activeOfferIdByRequestId[request.id];
              const configuredActiveIndex = group.items.findIndex(
                (item) => item.offer.id === configuredActiveOfferId,
              );
              const activeIndex =
                configuredActiveIndex >= 0 ? configuredActiveIndex : 0;
              const activeItem = group.items[activeIndex];

              if (!activeItem) {
                return null;
              }

              const activeAppointmentStatus = activeItem.appointment?.status;
              const activeIsCustomerProposed =
                activeAppointmentStatus === "customer_proposed";
              const affectedPartLabels = getAffectedPartLabels(
                request.serviceDetails,
              );
              const detailedDamageTypeLabels = getDamageTypeLabels(
                request.serviceDetails,
              );
              const fallbackDamageTypeLabel = getDamageTypeLabel(
                request.damageType,
              );
              const displayedDamageTypeLabels =
                detailedDamageTypeLabels.length > 0
                  ? detailedDamageTypeLabels
                  : fallbackDamageTypeLabel
                  ? [fallbackDamageTypeLabel]
                  : [];

              return (
                <div
                  key={request.id}
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
                    affectedParts={affectedPartLabels}
                    damageTypes={displayedDamageTypeLabels}
                  />

                  <div className="mt-3 flex justify-end">
                    <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
                      {group.items.length} {group.items.length === 1 ? "ofertă" : "oferte"}
                    </span>
                  </div>

                  <div
                    ref={(node) => {
                      carouselRefs.current[request.id] = node;
                    }}
                    onScroll={(event) =>
                      handleCarouselScroll(request.id, group.items, event)
                    }
                    className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {group.items.map((item) => {
                      const { offer, appointment } = item;
                      const appointmentStatus = appointment?.status;
                      const isCustomerProposed =
                        appointmentStatus === "customer_proposed";
                      const isWorkshopProposed =
                        appointmentStatus === "workshop_proposed" ||
                        appointmentStatus === "requested";
                      const customerBadgeText =
                        appointmentStatus === "confirmed"
                          ? "Programare confirmată"
                          : appointmentStatus === "customer_proposed"
                            ? "În așteptare"
                            : appointmentStatus === "workshop_proposed"
                              ? "Service-ul a propus altă dată"
                              : "Necesită programare";
                      const customerBadgeClass =
                        appointmentStatus === "confirmed"
                          ? "bg-emerald-50 text-emerald-700"
                          : appointmentStatus === "customer_proposed"
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-orange-50 text-orange-700";
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
                          className="min-w-full shrink-0 snap-start px-px"
                        >
                          <div className="mt-4 flex justify-start">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-bold ${customerBadgeClass}`}
                            >
                              {customerBadgeText}
                            </span>
                          </div>

                          <WorkshopSummaryCard
                            workshopUserId={offer.workshopUserId}
                            workshopName={offer.workshopName}
                            workshopLogoUrl={offer.workshopLogoUrl}
                            workshopSlug={offer.workshopSlug}
                            onClick={() =>
                              openWorkshopProfile(offer.workshopSlug)
                            }
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
                        </div>
                      );
                    })}
                  </div>

                  {group.items.length > 1 && (
                    <div className="mt-3 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          moveCarousel(
                            request.id,
                            group.items,
                            activeIndex,
                            -1,
                          )
                        }
                        disabled={activeIndex === 0}
                        className="hidden h-9 w-9 items-center justify-center rounded-full bg-black text-white transition disabled:cursor-not-allowed disabled:opacity-25 md:inline-flex"
                        aria-label="Oferta anterioară"
                      >
                        <ChevronLeft size={18} />
                      </button>

                      <p className="min-w-24 text-center text-xs font-bold text-black/50">
                        {activeIndex + 1} / {group.items.length} oferte
                      </p>

                      <button
                        type="button"
                        onClick={() =>
                          moveCarousel(
                            request.id,
                            group.items,
                            activeIndex,
                            1,
                          )
                        }
                        disabled={activeIndex === group.items.length - 1}
                        className="hidden h-9 w-9 items-center justify-center rounded-full bg-black text-white transition disabled:cursor-not-allowed disabled:opacity-25 md:inline-flex"
                        aria-label="Oferta următoare"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>
                  )}

                  <AppointmentActions
                    showConfirm={!activeIsCustomerProposed}
                    confirming={acceptingOfferId === activeItem.offer.id}
                    confirmDisabled={acceptingOfferId !== null || isNavigating}
                    onConfirm={() =>
                      handleConfirmAppointment(activeItem.offer.id)
                    }
                    onChat={() =>
                      navigate(
                        `/chat/${activeItem.request.id}?offerId=${activeItem.offer.id}`,
                      )
                    }
                    onChangeDate={() =>
                      navigate(
                        `/customer/schedule-damage/${activeItem.request.id}?offerId=${activeItem.offer.id}&from=customer`,
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
