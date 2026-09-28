"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOwnRepairRequests,
  type RepairRequestRow,
} from "@/lib/supabase/repair-requests";
import {
  getOffersForCustomerRequests,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";
import CarHeader from "@/app/components/CarHeader";
import { Eye } from "lucide-react";
import OfferSummaryCard from "@/app/components/OfferSummaryCard";
import WorkshopSummaryCard from "@/app/components/WorkshopSummaryCard";
import TowingRouteEstimateCard from "@/app/components/towing/TowingRouteEstimateCard";
import { interactiveButton } from "@/lib/ui";
import { WORKSHOP_STARTED_JOB_NOTIFICATION_TYPE } from "@/lib/notifications";
import { sortJobsByLatestActivity } from "@/lib/services/jobs/sort-jobs";
import {
  getAffectedPartLabels,
  getDamageTypeLabels,
} from "@/lib/car-damage";
import {
  getDamageTypeLabel,
  getRequestTypeBadgeLabel,
} from "@/lib/displayLabels";
import {
  formatProgressStatus,
  normalizeProgressStatus,
} from "@/lib/work-progress/workflows";
import { getMechanicalServiceDetailGroups } from "@/lib/mechanical/mechanical-service-details";
import { getTowingDisplaySummary } from "@/lib/towing/towing-display";
import { getWheelsDisplaySummary } from "@/lib/wheels/wheels-display";
import RequestCategoryFilter, {
  type RequestCategoryCounts,
  type RequestCategoryFilter as RequestCategory,
} from "@/app/components/RequestCategoryFilter";
import {
  isRepairServiceType,
  resolveRepairServiceType,
} from "@/lib/repair-requests/service-types";

type RepairAppointment = {
  id: string;
  request_id: string;
  appointment_date: string;
  appointment_time: string;
  handover_method: "customer_dropoff" | "workshop_pickup";
  pickup_address: string | null;
  customer_note: string | null;
  workshop_note: string | null;

  proposed_date: string | null;
  proposed_time: string | null;

  updated_at?: string | null;

  status:
    | "workshop_proposed"
    | "customer_proposed"
    | "confirmed"
    | "declined"
    | "cancelled";
};

type JobsTab = "scheduled" | "in_progress" | "completed";

type UnreadProgressRow = {
  request_id: string;
  unread_count: number;
};

type WorkProgressRow = {
  id: string;
  request_id: string;
  status: string | null;
  created_at: string;
};

const PROGRESS_PAGE_SIZE = 500;

const INITIAL_CATEGORY_BY_TAB: Record<JobsTab, RequestCategory> = {
  scheduled: "all",
  in_progress: "all",
  completed: "all",
};

const JOB_CATEGORY_TITLES: Record<Exclude<RequestCategory, "all">, string> = {
  bodywork: "DAUNE ESTETICE",
  mechanical: "DAUNE MECANICE",
  wheels: "ROȚI ȘI ANVELOPE",
  towing: "TRACTĂRI AUTO",
};

export default function MyJobsPage() {
  const router = useRouter();

  const [requests, setRequests] = useState<RepairRequestRow[]>([]);
  const [offers, setOffers] = useState<RepairOfferRow[]>([]);
  const [progressByRequestId, setProgressByRequestId] = useState<
    Record<
      string,
      {
        latestStatus: string | null;
        count: number;
        completionTimestamp: string | null;
      }
    >
  >({});
  const [loading, setLoading] = useState(true);
  const [unreadByRequestId, setUnreadByRequestId] = useState<
    Record<string, number>
  >({});
  const [reviewedRequestIds, setReviewedRequestIds] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<RepairAppointment[]>([]);
  const [workshopSlugs, setWorkshopSlugs] = useState<Record<string, string>>(
    {},
  );

  const isValidTab = (tab: string | null): tab is JobsTab =>
    tab === "scheduled" || tab === "in_progress" || tab === "completed";

  const [activeTab, setActiveTab] = useState<JobsTab>("scheduled");
  const [activeCategoryByTab, setActiveCategoryByTab] = useState<
    Record<JobsTab, RequestCategory>
  >(INITIAL_CATEGORY_BY_TAB);
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null);
  const [highlightedRequestId, setHighlightedRequestId] = useState<
    string | null
  >(null);
  const focusedRequestCardRef = useRef<HTMLDivElement | null>(null);
  const consumedFocusRequestRef = useRef<string | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const jobsSessionRef = useRef(0);
  const jobsLoadGenerationRef = useRef(0);
  const jobsRefreshInFlightRef = useRef(false);
  const jobsRefreshPendingRef = useRef(false);
  const jobsRefreshPendingInitialRef = useRef(false);
  const jobsUserIdRef = useRef<string | null>(null);
  const hasLoadedJobsRef = useRef(false);
  const scheduleJobsRefreshRef = useRef<(reason: string) => void>(() => {});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const category = params.get("category");
    const focusRequest = params.get("focusRequest");

    if (isUuid(focusRequest)) {
      setFocusRequestId(focusRequest);
    }

    if (isValidTab(tab)) {
      setActiveTab(tab);

      if (isRepairServiceType(category)) {
        setActiveCategoryByTab((current) => ({
          ...current,
          [tab]: category,
        }));
      }
    }
  }, []);

  useEffect(() => {
    let active = true;
    let hasSubscribedToProgress = false;
    const lifecycleSession = jobsSessionRef.current + 1;
    jobsSessionRef.current = lifecycleSession;
    jobsLoadGenerationRef.current += 1;
    jobsRefreshInFlightRef.current = false;
    jobsRefreshPendingRef.current = false;
    jobsRefreshPendingInitialRef.current = false;
    jobsUserIdRef.current = null;
    hasLoadedJobsRef.current = false;

    const isLifecycleActive = () =>
      active && jobsSessionRef.current === lifecycleSession;

    const resetJobsState = () => {
      setRequests([]);
      setOffers([]);
      setProgressByRequestId({});
      setUnreadByRequestId({});
      setReviewedRequestIds([]);
      setAppointments([]);
      setWorkshopSlugs({});
    };

    const loadJobs = async (initialLoad: boolean) => {
      const generation = jobsLoadGenerationRef.current + 1;
      jobsLoadGenerationRef.current = generation;
      const isCurrentLoad = (userId?: string) =>
        isLifecycleActive() &&
        jobsLoadGenerationRef.current === generation &&
        (!userId || jobsUserIdRef.current === userId);

      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!isCurrentLoad()) return;

        if (!authData.user) {
          jobsUserIdRef.current = null;
          resetJobsState();
          router.push("/login");
          return;
        }

        const userId = authData.user.id;

        if (jobsUserIdRef.current && jobsUserIdRef.current !== userId) {
          resetJobsState();
        }
        jobsUserIdRef.current = userId;

        const { error: notificationsReadError } = await supabase
          .from("notifications")
          .update({
            read_at: new Date().toISOString(),
          })
          .eq("recipient_id", userId)
          .eq("recipient_role", "customer")
          .is("read_at", null)
          .in("type", [
            "workshop_confirmed_appointment",
            WORKSHOP_STARTED_JOB_NOTIFICATION_TYPE,
          ]);

        if (!isCurrentLoad(userId)) return;

        if (notificationsReadError) {
          console.error(
            "Failed to mark notifications as read:",
            notificationsReadError,
          );
        } else {
          window.dispatchEvent(new Event("notifications-read-updated"));
        }

        const { data: reviewsData } = await supabase
          .from("reviews")
          .select("request_id")
          .eq("customer_user_id", userId);

        if (!isCurrentLoad(userId)) return;

        const [requestRows, offerRows] = await Promise.all([
          getOwnRepairRequests(userId),
          getOffersForCustomerRequests(userId),
        ]);

        if (!isCurrentLoad(userId)) return;

        const workshopUserIds = Array.from(
          new Set(
            offerRows.map((offer) => offer.workshop_user_id).filter(Boolean),
          ),
        );
        const slugMap: Record<string, string> = {};

        if (workshopUserIds.length > 0) {
          const { data: profilesData } = await supabase
            .from("profiles")
            .select("id, workshop_slug")
            .in("id", workshopUserIds);

          if (!isCurrentLoad(userId)) return;

          (profilesData || []).forEach((profile) => {
            if (profile.id && profile.workshop_slug) {
              slugMap[profile.id] = profile.workshop_slug;
            }
          });
        }

        const { data: appointmentsData, error: appointmentsError } =
          await supabase
            .from("repair_appointments")
            .select(
              "id, request_id, appointment_date, appointment_time, handover_method, pickup_address, customer_note, workshop_note, proposed_date, proposed_time, status, updated_at",
            )
            .eq("customer_id", userId)
            .order("updated_at", { ascending: false });

        if (!isCurrentLoad(userId)) return;

        if (appointmentsError) {
          console.error("Failed to load appointments:", appointmentsError);
        }

        const { data: unreadData } = await supabase.rpc(
          "get_unread_progress_updates_by_request",
        );

        if (!isCurrentLoad(userId)) return;

        const unreadMap: Record<string, number> = {};

        ((unreadData || []) as UnreadProgressRow[]).forEach((row) => {
          unreadMap[row.request_id] = row.unread_count;
        });

        const unreadRequestIds = Object.keys(unreadMap).filter(
          (requestId) => unreadMap[requestId] > 0,
        );
        let nextUnreadByRequestId: Record<string, number> | null =
          unreadRequestIds.length === 0 ? unreadMap : null;

        if (unreadRequestIds.length > 0) {
          const { data: unreadUpdates, error: unreadUpdatesError } =
            await supabase
              .from("work_progress_updates")
              .select("id, request_id")
              .in("request_id", unreadRequestIds);

          if (!isCurrentLoad(userId)) return;

          if (unreadUpdatesError) {
            console.error(
              "Failed to load unread progress update ids:",
              unreadUpdatesError,
            );
          } else {
            const readsToInsert = (unreadUpdates || []).map((update) => ({
              update_id: update.id,
              user_id: userId,
              read_at: new Date().toISOString(),
            }));

            if (readsToInsert.length > 0) {
              const { error: progressReadError } = await supabase
                .from("work_progress_reads")
                .upsert(readsToInsert, {
                  onConflict: "update_id,user_id",
                });

              if (!isCurrentLoad(userId)) return;

              if (progressReadError) {
                console.error(
                  "Failed to mark progress updates as read:",
                  progressReadError,
                );
              } else {
                nextUnreadByRequestId = {};
                window.dispatchEvent(new Event("progress-read-updated"));
                window.dispatchEvent(new Event("offers-read-updated"));
              }
            }
          }
        }

        type ProgressByRequestId = Record<
          string,
          {
            latestStatus: string | null;
            count: number;
            completionTimestamp: string | null;
          }
        >;
        const requestIds = requestRows.map((request) => request.id);
        let nextProgressByRequestId: ProgressByRequestId | null = null;

        if (requestIds.length === 0) {
          nextProgressByRequestId = {};
        } else {
          const progressUpdates: WorkProgressRow[] = [];
          const seenProgressUpdateIds = new Set<string>();
          let progressRangeStart = 0;
          let expectedProgressCount: number | null = null;
          let progressCollectionComplete = true;

          while (true) {
            const { data, error: progressError, count } = await supabase
              .from("work_progress_updates")
              .select("id, request_id, status, created_at", {
                count: "exact",
              })
              .in("request_id", requestIds)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(
                progressRangeStart,
                progressRangeStart + PROGRESS_PAGE_SIZE - 1,
              );

            if (!isCurrentLoad(userId)) return;

            if (progressError) {
              console.error("Failed to load work progress:", progressError);
              progressCollectionComplete = false;
              break;
            }

            if (count === null) {
              console.error("Failed to determine total work progress count.");
              progressCollectionComplete = false;
              break;
            }

            expectedProgressCount = Math.max(
              expectedProgressCount ?? 0,
              count,
            );

            const progressPage = (data || []) as WorkProgressRow[];

            for (const update of progressPage) {
              if (seenProgressUpdateIds.has(update.id)) continue;

              seenProgressUpdateIds.add(update.id);
              progressUpdates.push(update);
            }

            progressRangeStart += progressPage.length;

            if (progressPage.length === 0) {
              if (progressRangeStart < expectedProgressCount) {
                console.error("Work progress pagination ended prematurely.");
                progressCollectionComplete = false;
              }
              break;
            }

            if (
              progressPage.length < PROGRESS_PAGE_SIZE &&
              progressRangeStart >= expectedProgressCount
            ) {
              break;
            }
          }

          if (
            progressCollectionComplete &&
            seenProgressUpdateIds.size !== expectedProgressCount
          ) {
            console.error("Work progress pagination returned incomplete data.");
            progressCollectionComplete = false;
          }

          if (progressCollectionComplete) {
            const progressMap: ProgressByRequestId = Object.fromEntries(
              requestRows.map((request) => [
                request.id,
                {
                  latestStatus: null,
                  count: 0,
                  completionTimestamp: null,
                },
              ]),
            );
            const latestStatusRequestIds = new Set<string>();

            for (const update of progressUpdates) {
              const progress = progressMap[update.request_id];

              if (!progress) continue;

              progress.count += 1;

              if (!latestStatusRequestIds.has(update.request_id)) {
                progress.latestStatus = update.status || null;
                latestStatusRequestIds.add(update.request_id);
              }

              if (
                progress.completionTimestamp === null &&
                normalizeProgressStatus(update.status) === "Ready"
              ) {
                progress.completionTimestamp = update.created_at;
              }
            }

            nextProgressByRequestId = progressMap;
          }
        }

        if (!isCurrentLoad(userId)) return;

        setReviewedRequestIds(
          (reviewsData || []).map((review) => review.request_id).filter(Boolean),
        );
        setRequests(requestRows);
        setOffers(offerRows);
        setWorkshopSlugs(slugMap);
        setAppointments((appointmentsData || []) as RepairAppointment[]);
        if (nextUnreadByRequestId !== null) {
          setUnreadByRequestId(nextUnreadByRequestId);
        }
        if (nextProgressByRequestId !== null) {
          setProgressByRequestId(nextProgressByRequestId);
        }
        hasLoadedJobsRef.current = true;
      } catch (error) {
        if (!isCurrentLoad()) return;

        console.error("Failed to load jobs:", error);
        if (initialLoad || !hasLoadedJobsRef.current) {
          alert("Nu am putut încărca programările.");
        }
      } finally {
        if (initialLoad && isCurrentLoad()) {
          setLoading(false);
        }
      }
    };

    const runRefreshQueue = async (initialLoad: boolean) => {
      jobsRefreshInFlightRef.current = true;
      let nextLoadIsInitial = initialLoad;

      try {
        do {
          jobsRefreshPendingRef.current = false;
          jobsRefreshPendingInitialRef.current = false;
          await loadJobs(nextLoadIsInitial);
          nextLoadIsInitial = jobsRefreshPendingInitialRef.current;
        } while (isLifecycleActive() && jobsRefreshPendingRef.current);
      } finally {
        if (isLifecycleActive()) {
          jobsRefreshInFlightRef.current = false;
        }
      }
    };

    const scheduleJobsRefresh = (reason: string, initialLoad = false) => {
      if (!isLifecycleActive()) return;

      if (jobsRefreshInFlightRef.current) {
        jobsRefreshPendingRef.current = true;
        if (initialLoad) {
          jobsRefreshPendingInitialRef.current = true;
        }
        return;
      }

      if (process.env.NODE_ENV === "development") {
        console.log("[MY-JOBS] refresh", { reason, initialLoad });
      }
      void runRefreshQueue(initialLoad);
    };

    scheduleJobsRefreshRef.current = (reason) => {
      scheduleJobsRefresh(reason);
    };
    scheduleJobsRefresh("initial-load", true);

    const handleFocus = () => {
      scheduleJobsRefresh("focus");
    };

    window.addEventListener("focus", handleFocus);

    const appointmentsChannel = supabase
      .channel("customer-appointments-live")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_appointments",
        },
        () => {
          scheduleJobsRefresh("realtime:repair-appointments");
        },
      )
      .subscribe();

    const progressChannel = supabase
      .channel("customer-work-progress-live")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "work_progress_updates",
        },
        () => {
          scheduleJobsRefresh("realtime:work-progress");
        },
      )
      .subscribe((status, error) => {
        if (process.env.NODE_ENV === "development") {
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            console.warn(`[WORK-PROGRESS-RT] ${status}`, error ?? undefined);
          }
        }

        if (status === "SUBSCRIBED") {
          if (hasSubscribedToProgress) {
            scheduleJobsRefresh("realtime:reconnected");
          }

          hasSubscribedToProgress = true;
        }
      });

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUserId = session?.user?.id ?? null;
      const previousUserId = jobsUserIdRef.current;

      if (previousUserId === nextUserId) return;

      if (previousUserId === null) {
        jobsUserIdRef.current = nextUserId;
        return;
      }

      jobsSessionRef.current += 1;
      jobsLoadGenerationRef.current += 1;
      jobsRefreshPendingRef.current = false;
      jobsRefreshPendingInitialRef.current = false;
      jobsUserIdRef.current = nextUserId;
      hasLoadedJobsRef.current = false;
      resetJobsState();

      if (!nextUserId) {
        router.push("/login");
        return;
      }

      jobsSessionRef.current = lifecycleSession;
      setLoading(true);
      scheduleJobsRefresh("auth-user-changed", true);
    });

    return () => {
      active = false;
      jobsSessionRef.current += 1;
      jobsLoadGenerationRef.current += 1;
      jobsRefreshPendingRef.current = false;
      jobsRefreshPendingInitialRef.current = false;
      scheduleJobsRefreshRef.current = () => {};
      window.removeEventListener("focus", handleFocus);
      authSubscription.unsubscribe();
      void supabase.removeChannel(appointmentsChannel);
      void supabase.removeChannel(progressChannel);
    };
  }, [router]);

  const jobs = useMemo(() => {
    return requests
      .filter((request) => {
        const status = request.status || "";

        return ["matched", "in_progress", "completed"].includes(status);
      })
      .map((request) => {
        const acceptedOffer = offers.find(
          (offer) =>
            offer.id === request.accepted_offer_id ||
            (offer.request_id === request.id && offer.status === "accepted"),
        );

        return {
          request,
          acceptedOffer,
        };
      });
  }, [requests, offers]);

  const latestAppointmentByRequestId = new Map<string, RepairAppointment>();

  appointments.forEach((appointment) => {
    const current = latestAppointmentByRequestId.get(appointment.request_id);

    if (
      !current ||
      new Date(appointment.updated_at || 0).getTime() >
        new Date(current.updated_at || 0).getTime()
    ) {
      latestAppointmentByRequestId.set(appointment.request_id, appointment);
    }
  });

  const jobsWithAppointments = sortJobsByLatestActivity(
    jobs.map((job) => {
      const appointment = latestAppointmentByRequestId.get(job.request.id);

      return {
        ...job,
        appointment,
      };
    }),
  );

  const scheduledJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "matched",
  );

  const inProgressJobs = jobsWithAppointments.filter(
    ({ request }) => request.status === "in_progress",
  );

  const completedJobs = jobsWithAppointments
    .filter(({ request }) => request.status === "completed")
    .sort((first, second) => {
      const firstCompletion = getValidTimestamp(
        progressByRequestId[first.request.id]?.completionTimestamp,
      );
      const secondCompletion = getValidTimestamp(
        progressByRequestId[second.request.id]?.completionTimestamp,
      );

      if (firstCompletion !== null && secondCompletion !== null) {
        return secondCompletion - firstCompletion;
      }

      if (firstCompletion !== null) return -1;
      if (secondCompletion !== null) return 1;

      return (
        getValidTimestamp(second.request.created_at) ?? 0
      ) - (getValidTimestamp(first.request.created_at) ?? 0);
    });

  const visibleJobs =
    activeTab === "scheduled"
      ? scheduledJobs
      : activeTab === "in_progress"
        ? inProgressJobs
        : completedJobs;

  const categoryCounts = useMemo(() => {
    const getCounts = (
      tabJobs: typeof visibleJobs,
    ): RequestCategoryCounts => {
      const counts: RequestCategoryCounts = {
        all: tabJobs.length,
        bodywork: 0,
        mechanical: 0,
        wheels: 0,
        towing: 0,
      };

      tabJobs.forEach(({ request }) => {
        const serviceType = resolveRepairServiceType(request.service_type);

        if (serviceType) {
          counts[serviceType] += 1;
        }
      });

      return counts;
    };

    return {
      scheduled: getCounts(scheduledJobs),
      in_progress: getCounts(inProgressJobs),
      completed: getCounts(completedJobs),
    };
  }, [completedJobs, inProgressJobs, scheduledJobs]);

  const activeCategory = activeCategoryByTab[activeTab];
  const filteredVisibleJobs =
    activeCategory === "all"
      ? visibleJobs
      : visibleJobs.filter(
          ({ request }) =>
            resolveRepairServiceType(request.service_type) === activeCategory,
        );

  useEffect(() => {
    if (
      loading ||
      !focusRequestId ||
      consumedFocusRequestRef.current === focusRequestId
    ) {
      return;
    }

    const targetExists = filteredVisibleJobs.some(
      ({ request }) => request.id === focusRequestId,
    );

    if (!targetExists || !focusedRequestCardRef.current) {
      return;
    }

    consumedFocusRequestRef.current = focusRequestId;
    focusedRequestCardRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    setHighlightedRequestId(focusRequestId);

    if (highlightTimeoutRef.current !== null) {
      window.clearTimeout(highlightTimeoutRef.current);
    }

    highlightTimeoutRef.current = window.setTimeout(() => {
      setHighlightedRequestId((current) =>
        current === focusRequestId ? null : current,
      );
      highlightTimeoutRef.current = null;
    }, 2000);

    const params = new URLSearchParams(window.location.search);

    if (params.get("focusRequest") === focusRequestId) {
      params.delete("focusRequest");
      const query = params.toString();

      router.replace(
        `${window.location.pathname}${query ? `?${query}` : ""}`,
        { scroll: false },
      );
    }
  }, [filteredVisibleJobs, focusRequestId, loading, router]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current !== null) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  const acceptAppointmentProposal = async (appointmentId: string) => {
    try {
      const { error } = await supabase
        .from("repair_appointments")
        .update({
          status: "confirmed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", appointmentId);

      if (error) throw error;

      scheduleJobsRefreshRef.current("appointment-accepted");
    } catch (error) {
      console.error("Failed to accept appointment:", error);
      alert("Nu am putut confirma programarea.");
    }
  };

  const changeTab = (tab: JobsTab) => {
    setActiveTab(tab);
    router.replace(`/customer/my-jobs?tab=${tab}`, {
      scroll: false,
    });
  };

  return (
    <main className="min-h-screen bg-[#111111] px-4 pb-5 pt-4 text-white">
      <div className="mx-auto max-w-5xl">
        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            {activeCategory === "all"
              ? "PROGRAMĂRI"
              : JOB_CATEGORY_TITLES[activeCategory]}
          </p>
        </section>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
          <TabButton
            label="Programate"
            count={scheduledJobs.length}
            active={activeTab === "scheduled"}
            onClick={() => changeTab("scheduled")}
          />

          <TabButton
            label="În lucru"
            count={inProgressJobs.length}
            active={activeTab === "in_progress"}
            onClick={() => changeTab("in_progress")}
          />

          <TabButton
            label="Finalizate"
            count={completedJobs.length}
            active={activeTab === "completed"}
            onClick={() => changeTab("completed")}
          />
        </div>

        <div className="mb-5">
          <RequestCategoryFilter
            activeCategory={activeCategory}
            counts={categoryCounts[activeTab]}
            onChange={(category) => {
              setActiveCategoryByTab((current) => ({
                ...current,
                [activeTab]: category,
              }));
            }}
          />
        </div>

        {loading ? (
          <p className="text-white/60">Se încarcă programările...</p>
        ) : jobs.length === 0 ? (
          <div className="rounded-[22px] bg-white p-6 text-center text-black">
            <h2 className="text-xl font-bold">Nu ai programări încă</h2>
            <p className="mt-2 text-sm text-black/60">
              Când accepți o ofertă, lucrarea programată va apărea aici.
            </p>

            <button
              onClick={() => router.push("/offers")}
              className="mt-5 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white"
            >
              Vezi ofertele
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredVisibleJobs.length === 0 && (
              <div className="rounded-[22px] bg-white p-6 text-center text-black">
                <h2 className="text-xl font-bold">Nimic aici momentan</h2>
                <p className="mt-2 text-sm text-black/60">
                  Nu ai programări pentru această categorie.
                </p>
              </div>
            )}
            {filteredVisibleJobs.map(({ request, acceptedOffer, appointment }) => {
              const affectedPartLabels = getAffectedPartLabels(
                request.service_details,
              );
              const detailedDamageTypeLabels = getDamageTypeLabels(
                request.service_details,
              );
              const fallbackDamageTypeLabel = getDamageTypeLabel(
                request.damage_type,
              );
              const mechanicalDetails =
                request.service_type === "mechanical"
                  ? getMechanicalServiceDetailGroups(request.service_details)
                  : [];
              const wheelsSummary =
                request.service_type === "wheels"
                  ? getWheelsDisplaySummary(request.service_details)
                  : undefined;
              const showsTowingDetails =
                (activeTab === "scheduled" ||
                  activeTab === "in_progress" ||
                  activeTab === "completed") &&
                request.service_type === "towing";
              const towingSummary =
                showsTowingDetails
                  ? getTowingDisplaySummary(request.service_details)
                  : undefined;
              const hasValidTowingRoute =
                showsTowingDetails &&
                isNonNegativeFinite(request.route_distance_meters) &&
                isNonNegativeFinite(request.route_duration_seconds);
              const towingPickup =
                isFiniteCoordinate(request.pickup_lat, -90, 90) &&
                isFiniteCoordinate(request.pickup_lng, -180, 180)
                  ? { lat: request.pickup_lat, lng: request.pickup_lng }
                  : null;
              const towingDestination =
                isFiniteCoordinate(request.destination_lat, -90, 90) &&
                isFiniteCoordinate(request.destination_lng, -180, 180)
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
              const latestProgressStatus =
                progressByRequestId[request.id]?.latestStatus ?? null;
              const latestProgressLabel = latestProgressStatus
                ? formatJobStatus(latestProgressStatus)
                : null;
              const isAppointmentConfirmed =
                appointment?.status === "confirmed";
              const isAppointmentRequested =
                !appointment || appointment.status === "workshop_proposed";

              return (
                <div
                  key={request.id}
                  ref={
                    request.id === focusRequestId
                      ? focusedRequestCardRef
                      : undefined
                  }
                  onClick={() => router.push(`/customer/my-jobs/${request.id}`)}
                  className={`cursor-pointer overflow-hidden rounded-[30px] bg-white p-4 text-black shadow-xl transition ${
                    highlightedRequestId === request.id
                      ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-[#111111]"
                      : ""
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <CarHeader
                        images={request.images}
                        plate={request.license_plate}
                        platePosition="bottom"
                        brand={request.car_brand}
                        model={request.car_model}
                        year={request.car_year}
                        city={request.city}
                        variant="listLarge"
                        separateLocation
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
                          {
                            text:
                              activeTab === "scheduled"
                                ? appointment?.status === "confirmed"
                                  ? "Programare confirmată"
                                  : appointment?.status === "workshop_proposed"
                                    ? "Service-ul a propus altă dată"
                                    : "Necesită programare"
                                : activeTab === "in_progress"
                                  ? "În lucru"
                                  : "Finalizată",
                            color:
                              activeTab === "scheduled"
                                ? appointment?.status === "confirmed"
                                  ? "blue"
                                  : appointment?.status === "workshop_proposed"
                                    ? "orange"
                                    : "yellow"
                                : activeTab === "in_progress"
                                  ? "orange"
                                  : "green",
                          },
                          ...(activeTab === "in_progress" &&
                          latestProgressLabel &&
                          latestProgressLabel !== "În lucru"
                            ? [
                                {
                                  text: latestProgressLabel,
                                  color: "blue" as const,
                                },
                              ]
                            : []),
                          {
                            text: getRequestTypeBadgeLabel(
                              request.service_type,
                            ),
                            color: "orange",
                          },
                        ]}
                      />
                    </div>
                  </div>

                  {hasValidTowingRoute && (
                    <div
                      className="mt-4 [&>section]:mb-0"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <TowingRouteEstimateCard
                        distanceMeters={request.route_distance_meters ?? null}
                        durationSeconds={
                          request.route_duration_seconds ?? null
                        }
                        pickup={towingPickup}
                        destination={towingDestination}
                        paths={request.route_paths}
                      />
                    </div>
                  )}

                  {acceptedOffer && (
                    <WorkshopSummaryCard
                      workshopUserId={acceptedOffer.workshop_user_id}
                      workshopName={acceptedOffer.workshop_name}
                      workshopLogoUrl={null}
                      workshopSlug={
                        workshopSlugs[acceptedOffer.workshop_user_id]
                      }
                      onClick={() => {
                        const slug =
                          workshopSlugs[acceptedOffer.workshop_user_id];

                        if (!slug) {
                          alert("Profilul service-ului nu este disponibil.");
                          return;
                        }

                        router.push(`/workshops/profile/${slug}`);
                      }}
                    />
                  )}

                  {acceptedOffer && (
                    <div
                      className="mt-5"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <OfferSummaryCard
                        title={
                          activeTab === "scheduled"
                            ? isAppointmentConfirmed
                              ? "Programare confirmată"
                              : "Programare în așteptare"
                            : activeTab === "in_progress"
                              ? "Lucrare în lucru"
                              : "Lucrare finalizată"
                        }
                        price={acceptedOffer.price}
                        days={
                          request.service_type === "towing"
                            ? null
                            : acceptedOffer.days
                        }
                        appointmentDate={
                          appointment?.status === "workshop_proposed"
                            ? appointment.proposed_date ||
                              appointment.appointment_date
                            : appointment?.appointment_date ||
                              acceptedOffer.available_date ||
                              null
                        }
                        appointmentTime={
                          appointment?.status === "workshop_proposed"
                            ? appointment.proposed_time ||
                              appointment.appointment_time
                            : appointment?.appointment_time ||
                              acceptedOffer.available_time ||
                              null
                        }
                        handoverText={
                          appointment?.handover_method === "workshop_pickup"
                            ? "Predare: Service-ul ridică mașina"
                            : "Predare: Clientul aduce mașina"
                        }
                        statusText={
                          activeTab === "scheduled"
                            ? isAppointmentConfirmed
                              ? "Confirmată"
                              : "Așteaptă confirmare"
                            : activeTab === "in_progress"
                              ? "În lucru"
                              : "Finalizată"
                        }
                      />
                      {activeTab === "scheduled" &&
                        appointment?.handover_method === "workshop_pickup" &&
                        appointment.pickup_address && (
                          <p className="mt-2 text-sm font-medium leading-5 text-black/60">
                            Adresă ridicare: {appointment.pickup_address}
                          </p>
                        )}
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-black/10 bg-black/[0.03] p-3">
                    <p className="mb-2 text-xs font-semibold text-black/45">
                      📝 Descriere
                    </p>

                    <p className="text-sm leading-6 text-black/70">
                      {request.description || "Fără descriere."}
                    </p>
                  </div>

                  <div className="mt-6 space-y-3">
                    {activeTab === "scheduled" &&
                      appointment?.status === "workshop_proposed" && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();

                            if (!appointment) {
                              alert("Programarea nu a fost găsită.");
                              return;
                            }

                            acceptAppointmentProposal(appointment.id);
                          }}
                          className={`${interactiveButton} w-full rounded-[20px] bg-orange-500 px-4 py-5 text-center text-sm font-black text-white`}
                        >
                          Acceptă programarea
                        </button>
                      )}

                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={!acceptedOffer}
                        onClick={(event) => {
                          event.stopPropagation();

                          if (!acceptedOffer) {
                            alert("Oferta acceptată nu a fost găsită.");
                            return;
                          }

                          router.push(
                            `/chat/${request.id}?offerId=${acceptedOffer.id}`,
                          );
                        }}
                        className={`${interactiveButton} rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white disabled:opacity-40`}
                      >
                        💬 Chat
                      </button>

                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();

                          if (
                            activeTab === "scheduled" &&
                            appointment?.status !== "confirmed"
                          ) {
                            router.push(
                              `/customer/schedule-damage/${request.id}`,
                            );
                            return;
                          }

                          router.push(`/customer/my-jobs/${request.id}`);
                        }}
                        className={`${interactiveButton} rounded-[20px] bg-black px-4 py-5 text-center text-sm font-bold text-white`}
                      >
                        {activeTab === "scheduled" &&
                        appointment?.status !== "confirmed" ? (
                          <>📅 Modifică data</>
                        ) : (
                          <span className="inline-flex items-center justify-center gap-2">
                            <Eye size={17} strokeWidth={2.4} />
                            Urmărește
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {request.status === "completed" && (
                    <div className="mt-3 flex justify-center">
                      {reviewedRequestIds.includes(request.id) ? (
                        <button
                          type="button"
                          disabled
                          className="rounded-2xl bg-emerald-100 px-4 py-4 text-base font-bold text-emerald-700"
                        >
                          ✓ Review trimis
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push(`/review?id=${request.id}`);
                          }}
                          className="rounded-2xl bg-orange-500 px-4 py-4 text-base font-bold text-white"
                        >
                          ⭐ Lasă review
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

function getAppointmentBadgeClass(
  status?: string | null,
  proposedDate?: string | null,
  proposedTime?: string | null,
) {
  if (status === "confirmed") return "bg-green-100 text-green-700";
  if (status === "customer_proposed") return "bg-orange-500 text-white";

  if (status === "workshop_proposed") return "bg-yellow-100 text-yellow-700";
  if (status === "declined") return "bg-red-100 text-red-700";
  if (status === "cancelled") return "bg-gray-100 text-gray-700";

  return "bg-orange-100 text-orange-700";
}

function formatAppointmentDate(date: string) {
  return new Date(date).toLocaleDateString("ro-RO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getValidTimestamp(value?: string | null): number | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function isUuid(value: string | null): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      ),
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

function formatJobStatus(status?: string | null) {
  if (normalizeProgressStatus(status)) {
    return formatProgressStatus(status);
  }

  switch (status) {
    case "in_progress":
      return "În lucru";

    case "completed":
      return "Finalizată";

    case "matched":
      return "Necesită programare";

    default:
      return "Necesită programare";
  }
}

function getStatusClass(status?: string | null) {
  switch (status) {
    case "Received":
    case "received":
      return "bg-gray-100 text-gray-700";

    case "Diagnosis":
    case "diagnosis":
      return "bg-yellow-100 text-yellow-700";

    case "Parts ordered":
    case "parts_ordered":
      return "bg-indigo-100 text-indigo-700";

    case "In repair":
    case "in repair":
    case "in_repair":
      return "bg-orange-100 text-orange-700";

    case "Testing":
    case "testing":
      return "bg-blue-100 text-blue-700";

    case "Ready":
    case "ready":
    case "Gata":
      return "bg-green-100 text-green-700";

    case "in_progress":
      return "bg-blue-100 text-blue-700";

    case "painting":
      return "bg-orange-100 text-orange-700";

    case "polishing":
      return "bg-purple-100 text-purple-700";

    case "completed":
      return "bg-green-100 text-green-700";

    case "matched":
      return "bg-yellow-100 text-yellow-700";

    default:
      return "bg-orange-100 text-orange-700";
  }
}

function formatAppointmentStatus(status?: string | null) {
  switch (status) {
    case "workshop_proposed":
      return "Service-ul a propus o programare";

    case "customer_proposed":
      return "Așteaptă confirmarea service-ului";

    case "confirmed":
      return "Programare confirmată";

    case "declined":
      return "Refuzată";

    case "cancelled":
      return "Anulată";

    default:
      return "Programare";
  }
}

function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${
        active ? "bg-orange-500 text-black" : "bg-white/10 text-white"
      }`}
    >
      {label} ({count})
    </button>
  );
}
