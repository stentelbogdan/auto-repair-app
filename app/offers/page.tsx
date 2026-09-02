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
import {
  getDamageTypeLabel,
  getRequestTypeBadgeLabel,
} from "@/lib/displayLabels";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
} from "@/lib/car-damage";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";

type ProfileRow = {
  role: string[] | null;
};

type OfferGroup = {
  request: CustomerOfferRepairRequest;
  items: CustomerOfferItem[];
};

type OfferCategoryFilter =
  | "all"
  | "bodywork"
  | "mechanical"
  | "wheels"
  | "towing";

const OFFER_CATEGORY_FILTERS: Array<{
  value: OfferCategoryFilter;
  ariaLabel: string;
  Icon: typeof AllOffersIcon;
}> = [
  { value: "all", ariaLabel: "Toate", Icon: AllOffersIcon },
  {
    value: "bodywork",
    ariaLabel: "Daune estetice",
    Icon: BodyworkOffersIcon,
  },
  {
    value: "mechanical",
    ariaLabel: "Probleme mecanice",
    Icon: MechanicalOffersIcon,
  },
  {
    value: "wheels",
    ariaLabel: "Roți și anvelope",
    Icon: WheelsOffersIcon,
  },
  { value: "towing", ariaLabel: "Tractări", Icon: TowingOffersIcon },
];

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
  const [activeCategory, setActiveCategory] =
    useState<OfferCategoryFilter>("all");
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

  const categoryCounts = useMemo(() => {
    const counts: Record<OfferCategoryFilter, number> = {
      all: items.length,
      bodywork: 0,
      mechanical: 0,
      wheels: 0,
      towing: 0,
    };

    offerGroups.forEach((group) => {
      const category = getOfferCategory(group.request.serviceType);

      if (category) {
        counts[category] += group.items.length;
      }
    });

    return counts;
  }, [items.length, offerGroups]);

  const filteredOfferGroups = useMemo(() => {
    if (activeCategory === "all") {
      return offerGroups;
    }

    return offerGroups.filter(
      (group) => getOfferCategory(group.request.serviceType) === activeCategory,
    );
  }, [activeCategory, offerGroups]);

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
        <header>
          <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
            Client
          </p>
          <h1 className="mt-1 text-2xl font-bold">Oferte primite</h1>
        </header>

        <div className="grid w-full grid-cols-5 gap-1 pb-1 sm:gap-2">
          {OFFER_CATEGORY_FILTERS.map((filter) => {
            const isActive = activeCategory === filter.value;
            const Icon = filter.Icon;

            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => setActiveCategory(filter.value)}
                className={`flex h-[78px] min-w-0 flex-col items-center justify-center gap-[6px] rounded-[18px] border transition active:scale-[0.98] ${
                  isActive
                    ? "border-orange-400/80 bg-orange-500/[0.09] text-orange-400 shadow-[0_0_18px_rgba(249,115,22,0.12)]"
                    : "border-white/10 bg-white/[0.035] text-white/75 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
                }`}
                aria-pressed={isActive}
                aria-label={filter.ariaLabel}
              >
                <Icon
                  className={`h-9 w-9 ${
                    isActive
                      ? "text-orange-400 [filter:drop-shadow(0_0_1.5px_rgba(249,115,22,0.4))]"
                      : "text-white [filter:drop-shadow(0_0_1.5px_rgba(255,255,255,0.45))]"
                  }`}
                />
                <span className="text-[11px] font-bold leading-none">
                  ({categoryCounts[filter.value]})
                </span>
              </button>
            );
          })}
        </div>

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
        ) : filteredOfferGroups.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-10 text-center text-white/70">
            Nu ai oferte pentru această categorie.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOfferGroups.map((group) => {
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
              const mechanicalDetails =
                request.serviceType === "mechanical"
                  ? getMechanicalServiceDetailGroups(request.serviceDetails)
                  : [];
              const wheelsSummary =
                request.serviceType === "wheels"
                  ? getWheelsDisplaySummary(request.serviceDetails)
                  : undefined;
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
                  <div className="relative pb-20">
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
                      damageTypes={
                        mechanicalDetails.length > 0 || wheelsSummary
                          ? []
                          : displayedDamageTypeLabels
                      }
                      mechanicalDetails={mechanicalDetails}
                      wheelsSummary={wheelsSummary}
                    />

                    <div className="absolute left-0 top-[196px] flex w-[150px] flex-col items-center gap-1.5">
                      <span className="rounded-full bg-orange-50 px-4 py-1.5 text-sm font-bold text-orange-700">
                        {group.items.length}{" "}
                        {group.items.length === 1 ? "ofertă" : "oferte"}
                      </span>

                      <span className="flex max-w-full items-center justify-center gap-1.5 rounded-2xl bg-black/[0.04] px-2.5 py-1">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-orange-500" />
                        <span className="min-w-0 text-center text-xs font-bold leading-tight text-orange-600">
                          {getRequestTypeBadgeLabel(request.serviceType)}
                        </span>
                      </span>
                    </div>
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

function getOfferCategory(
  serviceType: CustomerOfferRepairRequest["serviceType"],
): Exclude<OfferCategoryFilter, "all" | "towing"> | null {
  if (!serviceType || serviceType === "bodywork") {
    return "bodywork";
  }

  if (serviceType === "mechanical") {
    return "mechanical";
  }

  if (serviceType === "wheels") {
    return "wheels";
  }

  return null;
}

type OfferFilterIconProps = {
  className?: string;
};

function AllOffersIcon({ className }: OfferFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="13" y="13" width="15" height="15" rx="3.5" />
      <rect x="36" y="13" width="15" height="15" rx="3.5" />
      <rect x="13" y="36" width="15" height="15" rx="3.5" />
      <rect x="36" y="36" width="15" height="15" rx="3.5" />
    </svg>
  );
}

function BodyworkOffersIcon({ className }: OfferFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 49V35l8-15h23l7 13v16" />
      <path d="M11 31h27M9 39l9 2h18l5-3" />
      <path d="M13 42h24l-3 7H17z" />
      <circle cx="25" cy="45.5" r="2.2" />
      <path d="M8 49h34M8 44H5M42 44h-3M8 49v5M39 49v5" />

      <ellipse cx="52" cy="8" rx="7" ry="3" />
      <path d="M45 8v11c0 4 3 7 7 8 4-1 7-4 7-8V8" />
      <path d="M49 27v4M55 27v4" />
      <rect x="45" y="30" width="15" height="9" rx="2" />
      <path d="M40 32h5v5h-5l-3-1v-3zM52 39l4 15h-6l-3-15" />
      <path d="M34 31l-4-2M34 35h-5M34 39l-4 2" />
    </svg>
  );
}

function MechanicalOffersIcon({ className }: OfferFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M5 48V31l8-18c1-3 4-5 8-5h19c4 0 7 2 8 5l7 18v17" />
      <path d="M11 29h38M10 38l10 3h17l10-3" />
      <path d="M18 42h20l-3 7H21z" />
      <circle cx="28" cy="45.5" r="2.2" />
      <path d="M8 48h39M8 43H5M47 43h-4M8 48v5M44 48v5" />
      <path d="M31 10l-4 6 6 2-4 6 8 3" />

      <path d="M49 29a11 11 0 0 0 12 15l-8-1-20 20a6 6 0 0 1-8-8l20-20-1-8a11 11 0 0 0 15 12l-7 7-7-1-1-7z" />
    </svg>
  );
}

function WheelsOffersIcon({ className }: OfferFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="43" cy="32" r="21" />
      <circle cx="43" cy="32" r="16" />
      <circle cx="43" cy="32" r="4" />
      <path d="M43 16v10M43 38v10M27 32h10M49 32h10" />
      <path d="M31.7 20.7l7.1 7.1M47.2 36.2l7.1 7.1M54.3 20.7l-7.1 7.1M38.8 36.2l-7.1 7.1" />

      <rect x="3" y="22" width="14" height="11" rx="1.5" />
      <path d="M17 25h8v5h-8M25 26.5h7M8 33v13c0 5-3 8-7 8" />
      <path d="M6 33h7l-2 11H7" />
    </svg>
  );
}

function TowingOffersIcon({ className }: OfferFilterIconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 42h38v10H3z" />
      <path d="M41 23h12l8 12v17H41z" />
      <path d="M47 12h7l3 11H44z" />
      <path d="M46 28h8l5 8H46zM55 43h6" />

      <path d="M5 38V27l6-8h17l8 8h4v11" />
      <path d="M12 27h18M7 34h4M34 34h4" />
      <circle cx="12" cy="38" r="4" />
      <circle cx="34" cy="38" r="4" />

      <path d="M3 47h8M39 47h3" />
      <circle cx="18" cy="52" r="5" />
      <circle cx="51" cy="52" r="5" />
    </svg>
  );
}
