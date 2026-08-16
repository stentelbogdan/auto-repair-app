"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import {
  MessageCircle,
  Wrench,
  Settings,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { BadgeEuro } from "lucide-react";

type Role = "customer" | "workshop";

type UnreadMessageRow = {
  request_id: string;
  offer_id: string | null;
  created_at: string;
  sender_id: string;
  sender_role: string;
};

type ConversationInboxStateRow = {
  request_id: string;
  offer_id: string | null;
  hidden_at: string;
};

function getConversationKey(requestId: string, offerId: string | null) {
  return `${requestId}::${offerId ?? "direct"}`;
}

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const { navigate, runLocked, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const [, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [progressUnreadCount, setProgressUnreadCount] = useState(0);
  const [offerUnreadCount, setOfferUnreadCount] = useState(0);
  const [activeRole, setActiveRole] = useState<Role>("customer");
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [roleParam, setRoleParam] = useState<Role | null>(null);
  const lastProgressCountRef = useRef(0);
  const [showProgressToast, setShowProgressToast] = useState(false);
  const isAdmin = userRoles.includes("admin");
  const [wonJobsUnreadCount, setWonJobsUnreadCount] = useState(0);
  const [directRequestsUnreadCount, setDirectRequestsUnreadCount] = useState(0);
  const [newRequestsUnreadCount, setNewRequestsUnreadCount] = useState(0);
  const [appointmentProposalUnreadCount, setAppointmentProposalUnreadCount] =
    useState(0);

  const [appointmentConfirmedUnreadCount, setAppointmentConfirmedUnreadCount] =
    useState(0);
  const [appointmentToast, setAppointmentToast] = useState<{
    title: string;
    message: string;
    targetUrl: string | null;
  } | null>(null);
  const [fromParam, setFromParam] = useState<string | null>(null);
  const perfStartRef = useRef(0);
  const unreadCountRef = useRef(0);
  const unreadMessagesGenerationRef = useRef(0);
  const unreadMessagesRefreshInFlightRef = useRef(false);
  const unreadMessagesPendingRefreshRef = useRef(false);
  const unreadMessagesPendingReasonRef = useRef<string | null>(null);
  const unreadMessagesRealtimeDegradedRef = useRef(false);
  const unreadMessagesSchedulerSessionRef = useRef(0);
  const unreadMessagesRequestIdRef = useRef(0);
  const lastBrowserNavigationEventRef = useRef<{
    type: "pageshow" | "pagehide" | "focus" | "popstate";
    timestamp: string;
    persisted?: boolean;
  } | null>(null);
  const logContextRef = useRef({
    pathname,
    userId,
    activeRole,
    roleParam,
    fromParam,
  });

  useEffect(() => {
    logContextRef.current = {
      pathname,
      userId,
      activeRole,
      roleParam,
      fromParam,
    };
  }, [activeRole, fromParam, pathname, roleParam, userId]);

  const logPerf = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      if (perfStartRef.current === 0) {
        perfStartRef.current = performance.now();
      }

      const context = logContextRef.current;
      const elapsed = (performance.now() - perfStartRef.current).toFixed(1);
      console.log("[MSG-PERF][Navbar]", {
        event,
        elapsedMs: Number(elapsed),
        pathname: context.pathname,
        userId: context.userId,
        activeRole: context.activeRole,
        isWorkshopMode:
          context.pathname.startsWith("/workshops") ||
          context.roleParam === "workshop" ||
          context.fromParam === "workshop" ||
          (context.pathname.startsWith("/chat") &&
            context.activeRole === "workshop"),
        ...details,
      });
    },
    [],
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const role = params.get("role");
    const from = params.get("from");

    setFromParam(from);

    if (role === "workshop" || role === "customer") {
      setRoleParam(role);
    } else {
      setRoleParam(null);
    }
  }, [pathname]);

  useEffect(() => {
    if (pathname.startsWith("/account")) {
      if (roleParam === "workshop" || roleParam === "customer") {
        localStorage.setItem("activeRole", roleParam);
        setActiveRole(roleParam);
        return;
      }
    }

    if (pathname.startsWith("/workshops")) {
      localStorage.setItem("activeRole", "workshop");
      setActiveRole("workshop");
      return;
    }

    if (pathname.startsWith("/customer")) {
      if (fromParam === "workshop" || roleParam === "workshop") {
        localStorage.setItem("activeRole", "workshop");
        setActiveRole("workshop");
        return;
      }

      localStorage.setItem("activeRole", "customer");
      setActiveRole("customer");
      return;
    }

    const savedRole = localStorage.getItem("activeRole");

    if (savedRole === "workshop" || savedRole === "customer") {
      setActiveRole(savedRole);
    }
  }, [pathname, roleParam, fromParam]);

  const isWorkshopMode =
    pathname.startsWith("/workshops") ||
    roleParam === "workshop" ||
    fromParam === "workshop" ||
    (pathname.startsWith("/chat") && activeRole === "workshop");

  const isClientMode = !isWorkshopMode;

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);

      if (session?.user?.id) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .single();

        setUserRoles(Array.isArray(profile?.role) ? profile.role : []);
      } else {
        setUserRoles([]);
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);

      if (!session?.user?.id) {
        setUserRoles([]);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setProgressUnreadCount(0);
      setOfferUnreadCount(0);
      setWonJobsUnreadCount(0);
      setDirectRequestsUnreadCount(0);
      setNewRequestsUnreadCount(0);
      setAppointmentProposalUnreadCount(0);
      setAppointmentConfirmedUnreadCount(0);
      setAppointmentToast(null);
      return;
    }

    const schedulerSession = unreadMessagesSchedulerSessionRef.current + 1;
    unreadMessagesSchedulerSessionRef.current = schedulerSession;
    unreadMessagesRefreshInFlightRef.current = false;
    unreadMessagesPendingRefreshRef.current = false;
    unreadMessagesPendingReasonRef.current = null;
    logPerf("scheduler:session:start", {
      schedulerSession,
      isWorkshopMode,
      isClientMode,
    });

    const loadUnreadMessages = async (reason: string) => {
      if (unreadMessagesSchedulerSessionRef.current !== schedulerSession) {
        return;
      }

      if (!userId) {
        logPerf("loadUnreadMessages:resetNoUser");
        setUnreadCount(0);
        return;
      }

      unreadMessagesRefreshInFlightRef.current = true;
      unreadMessagesPendingRefreshRef.current = false;
      unreadMessagesPendingReasonRef.current = null;

      const currentUserId = userId;
      let requestIds: string[] = [];
      let validWorkshopConversationKeys: Set<string> | null = null;
      const startedAt = performance.now();
      const generation = unreadMessagesGenerationRef.current + 1;
      const requestId = unreadMessagesRequestIdRef.current + 1;
      unreadMessagesGenerationRef.current = generation;
      unreadMessagesRequestIdRef.current = requestId;
      logPerf("loadUnreadMessages:start", {
        previousUnreadCount: unreadCountRef.current,
        reason,
        generation,
        requestId,
        schedulerSession,
        isWorkshopMode,
      });

      try {
        if (isWorkshopMode) {
          const [
            { data: directRequests, error: directRequestsError },
            { data: workshopOffers, error: workshopOffersError },
          ] = await Promise.all([
            supabase
              .from("repair_requests")
              .select("id")
              .eq("target_workshop_id", currentUserId),
            supabase
              .from("repair_offers")
              .select("id, request_id")
              .eq("workshop_user_id", currentUserId)
              .in("status", ["pending", "accepted"]),
          ]);

          if (directRequestsError) {
            console.error(
              "Failed to load workshop direct message requests:",
              directRequestsError,
            );
          }

          if (workshopOffersError) {
            console.error(
              "Failed to load workshop conversations:",
              workshopOffersError,
            );
          }

          requestIds = [
            ...(directRequests || []).map((request) => request.id),
            ...(workshopOffers || []).map((offer) => offer.request_id),
          ];
          validWorkshopConversationKeys = new Set([
            ...(directRequests || []).map((request) =>
              getConversationKey(request.id, null),
            ),
            ...(workshopOffers || []).map((offer) =>
              getConversationKey(offer.request_id, offer.id),
            ),
          ]);
          logPerf("loadUnreadMessages:workshopRequestSources", {
            reason,
            generation,
            requestId,
            schedulerSession,
            directRequestIds: (directRequests || []).map(
              (request) => request.id,
            ),
            offerRequestIds: (workshopOffers || []).map(
              (offer) => offer.request_id,
            ),
          });
        } else {
          const { data: customerRequests } = await supabase
            .from("repair_requests")
            .select("id")
            .eq("user_id", currentUserId);

          requestIds = (customerRequests || []).map((request) => request.id);
        }

        requestIds = Array.from(new Set(requestIds)).filter(Boolean);
        logPerf("loadUnreadMessages:requestIds", {
          requestIdsCount: requestIds.length,
          requestIds,
          reason,
          generation,
          requestId,
          schedulerSession,
        });

        if (
          unreadMessagesSchedulerSessionRef.current !== schedulerSession ||
          unreadMessagesGenerationRef.current !== generation
        ) {
          logPerf("loadUnreadMessages:staleIgnored", {
            reason,
            generation,
            phase: "requestIds",
          });
          return;
        }

        if (requestIds.length === 0) {
          logPerf("loadUnreadMessages:end", {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            calculatedUnreadCount: 0,
            reason,
            generation,
          });
          logPerf("loadUnreadMessages:setUnreadCount", {
            nextUnreadCount: 0,
            reason: "no_request_ids",
            generation,
          });
          setUnreadCount(0);
          return;
        }

        const [unreadMessagesResult, inboxStatesResult] = await Promise.all([
          supabase
            .from("messages")
            .select(
              "request_id, offer_id, created_at, sender_id, sender_role",
            )
            .in("request_id", requestIds)
            .neq("sender_id", currentUserId)
            .neq("sender_role", "system")
            .is("read_at", null),
          supabase
            .from("conversation_inbox_states")
            .select("request_id, offer_id, hidden_at")
            .eq("user_id", currentUserId)
            .in("request_id", requestIds),
        ]);

        const unreadMessagesError = unreadMessagesResult.error;
        const inboxStatesError = inboxStatesResult.error;
        const unreadMessages = (unreadMessagesResult.data ||
          []) as UnreadMessageRow[];
        const inboxStates = (inboxStatesResult.data ||
          []) as ConversationInboxStateRow[];
        const hiddenAtByConversation = new Map(
          inboxStates.map((state) => [
            getConversationKey(state.request_id, state.offer_id ?? null),
            state.hidden_at,
          ]),
        );
        const unreadCountResult = unreadMessages.filter((message) => {
          if (message.sender_id === currentUserId) return false;
          if (message.sender_role === "system") return false;

          const conversationKey = getConversationKey(
            message.request_id,
            message.offer_id ?? null,
          );

          if (
            isWorkshopMode &&
            !validWorkshopConversationKeys?.has(conversationKey)
          ) {
            return false;
          }

          const hiddenAt = hiddenAtByConversation.get(conversationKey);

          if (!hiddenAt) return true;

          return (
            new Date(message.created_at).getTime() >
            new Date(hiddenAt).getTime()
          );
        }).length;

        logPerf("loadUnreadMessages:countResult", {
          calculatedUnreadCount: unreadCountResult,
          unreadRowsBeforeHiddenCutoff: unreadMessages.length,
          hiddenConversationStates: inboxStates.length,
          reason,
          generation,
          requestId,
          schedulerSession,
          requestIds,
          timestamp: new Date().toISOString(),
        });

        if (
          unreadMessagesSchedulerSessionRef.current !== schedulerSession ||
          unreadMessagesGenerationRef.current !== generation
        ) {
          logPerf("loadUnreadMessages:staleIgnored", {
            reason,
            generation,
            phase: "countResult",
          });
          return;
        }

        if (unreadMessagesError || inboxStatesError) {
          console.error(
            "Failed to load unread messages:",
            unreadMessagesError || inboxStatesError,
          );
          logPerf("loadUnreadMessages:error", {
            durationMs: Number((performance.now() - startedAt).toFixed(1)),
            error: (unreadMessagesError || inboxStatesError)?.message,
            reason,
            generation,
          });
          setUnreadCount(0);
          return;
        }

        logPerf("loadUnreadMessages:end", {
          durationMs: Number((performance.now() - startedAt).toFixed(1)),
          calculatedUnreadCount: unreadCountResult,
          reason,
          generation,
          requestId,
          schedulerSession,
        });
        logPerf("loadUnreadMessages:setUnreadCount", {
          nextUnreadCount: unreadCountResult,
          reason,
          generation,
          requestId,
          schedulerSession,
          lastBrowserNavigationEvent: lastBrowserNavigationEventRef.current,
        });
        setUnreadCount(unreadCountResult);
      } finally {
        if (unreadMessagesSchedulerSessionRef.current !== schedulerSession) {
          return;
        }

        unreadMessagesRefreshInFlightRef.current = false;

        if (unreadMessagesPendingRefreshRef.current) {
          const pendingReason =
            unreadMessagesPendingReasonRef.current || "pending-refresh";
          unreadMessagesPendingRefreshRef.current = false;
          unreadMessagesPendingReasonRef.current = null;
          logPerf("scheduleUnreadMessagesRefresh:drainPending", {
            reason: pendingReason,
          });
          void loadUnreadMessages(pendingReason);
        }
      }
    };

    const scheduleUnreadMessagesRefresh = (reason: string) => {
      if (unreadMessagesSchedulerSessionRef.current !== schedulerSession) {
        return;
      }

      logPerf("scheduleUnreadMessagesRefresh", {
        reason,
        schedulerSession,
        inFlight: unreadMessagesRefreshInFlightRef.current,
        pending: unreadMessagesPendingRefreshRef.current,
      });

      if (unreadMessagesRefreshInFlightRef.current) {
        const invalidatedGeneration =
          unreadMessagesGenerationRef.current + 1;
        unreadMessagesGenerationRef.current = invalidatedGeneration;
        unreadMessagesPendingRefreshRef.current = true;
        unreadMessagesPendingReasonRef.current = reason;
        logPerf("scheduleUnreadMessagesRefresh:queued", {
          reason,
          invalidatedGeneration,
        });
        return;
      }

      void loadUnreadMessages(reason);
    };

    const loadUnreadProgress = async () => {
      const { data, error } = await supabase.rpc(
        "get_unread_progress_updates_count",
      );

      if (error) {
        console.error("Failed to load progress unread:", error);
        setProgressUnreadCount(0);
        return;
      }

      const nextCount = Number(data || 0);

      if (
        isClientMode &&
        nextCount > lastProgressCountRef.current &&
        lastProgressCountRef.current !== 0
      ) {
        setShowProgressToast(true);

        setTimeout(() => {
          setShowProgressToast(false);
        }, 4000);
      }

      lastProgressCountRef.current = nextCount;
      setProgressUnreadCount(nextCount);
    };

    const loadUnreadOffers = async () => {
      const { data: customerRequests, error: requestsError } = await supabase
        .from("repair_requests")
        .select("id, status")
        .eq("user_id", userId);

      if (requestsError) {
        console.error("Failed to load customer requests:", requestsError);
        setOfferUnreadCount(0);
        return;
      }

      const requestIds = (customerRequests || [])
        .filter((request) => (request.status || "open") !== "completed")
        .map((request) => request.id);

      if (requestIds.length === 0) {
        setOfferUnreadCount(0);
        return;
      }

      const { count, error } = await supabase
        .from("repair_offers")
        .select("id", { count: "exact", head: true })
        .in("request_id", requestIds)
        .is("customer_read_at", null);

      if (error) {
        console.error("Failed to load unread offers:", error);
        setOfferUnreadCount(0);
        return;
      }

      setOfferUnreadCount(count || 0);
    };

    const loadUnreadAppointmentNotifications = async () => {
      const [
        { count: proposalCount, error: proposalError },
        { count: confirmedCount, error: confirmedError },
      ] = await Promise.all([
        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .is("read_at", null)
          .in("type", [
            "customer_proposed_appointment",
            "workshop_proposed_appointment",
          ]),

        supabase
          .from("notifications")
          .select("id", { count: "exact", head: true })
          .eq("recipient_id", userId)
          .is("read_at", null)
          .in("type", [
            "customer_confirmed_appointment",
            "workshop_confirmed_appointment",
          ]),
      ]);

      if (proposalError || confirmedError) {
        console.error(
          "Failed to load appointment notifications:",
          proposalError || confirmedError,
        );

        setAppointmentProposalUnreadCount(0);
        setAppointmentConfirmedUnreadCount(0);
        return;
      }

      setAppointmentProposalUnreadCount(proposalCount || 0);
      setAppointmentConfirmedUnreadCount(confirmedCount || 0);
    };

    const loadUnreadWonJobs = async () => {
      const { count, error } = await supabase
        .from("repair_offers")
        .select("id", { count: "exact", head: true })
        .eq("workshop_user_id", userId)
        .eq("status", "accepted")
        .is("workshop_read_at", null);

      if (error) {
        console.error("Failed to load unread won jobs:", error);
        setWonJobsUnreadCount(0);
        return;
      }

      setWonJobsUnreadCount(count || 0);
    };

    const loadUnreadDirectRequests = async () => {
      const { count, error } = await supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("target_workshop_id", userId)
        .is("target_workshop_read_at", null);

      if (error) {
        console.error("Failed to load unread direct requests:", error);
        return;
      }

      setDirectRequestsUnreadCount(count || 0);
    };

    const loadUnreadOpenRequests = async () => {
      if (!isWorkshopMode) {
        setNewRequestsUnreadCount(0);
        return;
      }

      const seenAt = localStorage.getItem(`open_requests_seen_at_${userId}`);

      let query = supabase
        .from("repair_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");

      if (seenAt) {
        query = query.gt("created_at", seenAt);
      }

      const { count, error } = await query;

      if (error) {
        console.error("Failed to load new open requests:", error);
        setNewRequestsUnreadCount(0);
        return;
      }

      setNewRequestsUnreadCount(count || 0);
    };

    scheduleUnreadMessagesRefresh("effect-start");
    loadUnreadProgress();
    loadUnreadOffers();
    loadUnreadWonJobs();
    loadUnreadDirectRequests();
    loadUnreadAppointmentNotifications();

    const handleConversationInboxStateChange = (payload: {
      eventType: "INSERT" | "UPDATE";
    }) => {
      logPerf("realtime:conversation-inbox-state", {
        eventType: payload.eventType,
      });
      scheduleUnreadMessagesRefresh("realtime:conversation-inbox-state");
    };

    const channel = supabase
      .channel(`navbar-live-badges-${userId}`)

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_offers",
        },
        async () => {
          await loadUnreadOffers();
          await loadUnreadWonJobs();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "repair_requests",
        },
        async () => {
          await loadUnreadDirectRequests();
          await loadUnreadOpenRequests();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        async (payload) => {
          const messagePayload = payload.new as
            | {
                id?: string;
                request_id?: string;
                offer_id?: string | null;
                read_at?: string | null;
              }
            | undefined;
          logPerf("realtime:messages", {
            eventType: payload.eventType,
            messageId: messagePayload?.id ?? null,
            requestId: messagePayload?.request_id ?? null,
            offerId: messagePayload?.offer_id ?? null,
            readAt: messagePayload?.read_at ?? null,
          });
          scheduleUnreadMessagesRefresh(`realtime:${payload.eventType}`);
        },
      )

      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_inbox_states",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          handleConversationInboxStateChange(payload);
        },
      )

      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_inbox_states",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          handleConversationInboxStateChange(payload);
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_progress_updates",
        },
        async () => {
          await loadUnreadProgress();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "work_progress_reads",
        },
        async () => {
          await loadUnreadProgress();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        async (payload) => {
          const notification = payload.new as {
            actor_id?: string | null;
            title?: string | null;
            message?: string | null;
            target_url?: string | null;
          };

          /*
      Protecție suplimentară:
      nu afișăm notificări produse de utilizatorul curent.
    */
          if (notification.actor_id === userId) {
            return;
          }

          await loadUnreadAppointmentNotifications();

          setAppointmentToast({
            title: notification.title || "Actualizare programare",
            message:
              notification.message ||
              "Ai primit o nouă actualizare de programare.",
            targetUrl: notification.target_url || null,
          });

          window.setTimeout(() => {
            setAppointmentToast(null);
          }, 5000);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        async () => {
          await loadUnreadAppointmentNotifications();
        },
      )

      .subscribe((status, error) => {
        logPerf("channel:status", { status });

        if (process.env.NODE_ENV === "development" && error) {
          console.error("[MSG-PERF][Navbar] Realtime subscription error", {
            status,
            name: error.name,
            message: error.message,
          });
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          unreadMessagesRealtimeDegradedRef.current = true;
          return;
        }

        if (status === "SUBSCRIBED") {
          if (unreadMessagesRealtimeDegradedRef.current) {
            unreadMessagesRealtimeDegradedRef.current = false;
            scheduleUnreadMessagesRefresh("realtime-recovered");
          }
        }
      });

    const refreshAllBadges = () => {
      loadUnreadProgress();
      loadUnreadOffers();
      loadUnreadWonJobs();
      loadUnreadDirectRequests();
      loadUnreadOpenRequests();
      loadUnreadAppointmentNotifications();
    };

    const refreshMessageBadgeOnly = (reason: string) => {
      logPerf("refreshMessageBadgeOnly", { reason });
      scheduleUnreadMessagesRefresh(reason);
    };

    const handleFocus = () => {
      const timestamp = new Date().toISOString();
      lastBrowserNavigationEventRef.current = {
        type: "focus",
        timestamp,
      };
      logPerf("browser:focus", {
        timestamp,
        unreadCount: unreadCountRef.current,
        visibilityState: document.visibilityState,
        windowPathname: window.location.pathname,
      });
      refreshMessageBadgeOnly("focus");
      refreshAllBadges();
    };

    const handlePageShow = (event: PageTransitionEvent) => {
      const timestamp = new Date().toISOString();
      lastBrowserNavigationEventRef.current = {
        type: "pageshow",
        timestamp,
        persisted: event.persisted,
      };
      logPerf("browser:pageshow", {
        timestamp,
        persisted: event.persisted,
        unreadCount: unreadCountRef.current,
        visibilityState: document.visibilityState,
        windowPathname: window.location.pathname,
      });
    };

    const handlePageHide = (event: PageTransitionEvent) => {
      const timestamp = new Date().toISOString();
      lastBrowserNavigationEventRef.current = {
        type: "pagehide",
        timestamp,
        persisted: event.persisted,
      };
      logPerf("browser:pagehide", {
        timestamp,
        persisted: event.persisted,
        unreadCount: unreadCountRef.current,
        visibilityState: document.visibilityState,
        windowPathname: window.location.pathname,
      });
    };

    const handlePopState = () => {
      const timestamp = new Date().toISOString();
      lastBrowserNavigationEventRef.current = {
        type: "popstate",
        timestamp,
      };
      logPerf("browser:popstate", {
        timestamp,
        unreadCount: unreadCountRef.current,
        visibilityState: document.visibilityState,
        windowPathname: window.location.pathname,
        historyState: window.history.state,
      });
    };

    const handleMessagesReadUpdated = () => {
      logPerf("event:messages-read-updated");
      refreshMessageBadgeOnly("messages-read-updated");
    };

    const handleConversationInboxStateUpdated = () => {
      logPerf("event:conversation-inbox-state-updated");
      refreshMessageBadgeOnly("conversation-inbox-state-updated");
    };

    const handleProgressReadUpdated = () => {
      loadUnreadProgress();
    };

    const handleOffersReadUpdated = () => {
      loadUnreadOffers();
      loadUnreadWonJobs();
    };

    const handleDirectRequestsReadUpdated = () => {
      loadUnreadDirectRequests();
      loadUnreadOpenRequests();
    };

    const handleNotificationsReadUpdated = () => {
      loadUnreadAppointmentNotifications();
    };

    window.addEventListener("focus", handleFocus);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("messages-read-updated", handleMessagesReadUpdated);
    window.addEventListener(
      "conversation-inbox-state-updated",
      handleConversationInboxStateUpdated,
    );
    window.addEventListener("progress-read-updated", handleProgressReadUpdated);
    window.addEventListener("offers-read-updated", handleOffersReadUpdated);
    window.addEventListener(
      "direct-requests-read-updated",
      handleDirectRequestsReadUpdated,
    );
    window.addEventListener(
      "notifications-read-updated",
      handleNotificationsReadUpdated,
    );

    return () => {
      logPerf("scheduler:session:cleanup", {
        schedulerSession,
        isWorkshopMode,
        isClientMode,
      });
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener(
        "messages-read-updated",
        handleMessagesReadUpdated,
      );
      window.removeEventListener(
        "conversation-inbox-state-updated",
        handleConversationInboxStateUpdated,
      );
      window.removeEventListener(
        "progress-read-updated",
        handleProgressReadUpdated,
      );
      window.removeEventListener("offers-read-updated", handleOffersReadUpdated);
      unreadMessagesSchedulerSessionRef.current += 1;
      unreadMessagesRefreshInFlightRef.current = false;
      unreadMessagesPendingRefreshRef.current = false;
      unreadMessagesPendingReasonRef.current = null;
      unreadMessagesRealtimeDegradedRef.current = false;
      window.removeEventListener(
        "direct-requests-read-updated",
        handleDirectRequestsReadUpdated,
      );
      window.removeEventListener(
        "notifications-read-updated",
        handleNotificationsReadUpdated,
      );

      supabase.removeChannel(channel);
    };
  }, [userId, isWorkshopMode, isClientMode, logPerf]);

  if (pathname === "/" || pathname === "/login") {
    return null;
  }

  const handleLogout = async () => {
    setLoggingOut(true);

    localStorage.removeItem("activeRole");
    await supabase.auth.signOut();

    window.location.href = "/login";
  };

  const getFreshRoles = async (): Promise<string[] | null> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      /*
       * Redirect automat de autentificare.
       * Rămâne separat de navigările provocate de utilizator.
       */
      router.push("/login");
      return null;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const freshRoles = Array.isArray(profile?.role) ? profile.role : [];

    setUserRoles(freshRoles);

    return freshRoles;
  };

  const goClient = () => {
    void runLocked(async ({ navigate }) => {
      const freshRoles = await getFreshRoles();

      /*
       * Utilizatorul nu mai este autentificat.
       * getFreshRoles a pornit deja redirectul automat.
       */
      if (freshRoles === null) {
        return;
      }

      if (!freshRoles.includes("customer")) {
        navigate("/account?role=customer");
        return;
      }

      localStorage.setItem("activeRole", "customer");
      setActiveRole("customer");

      navigate("/customer/dashboard");
    });
  };

  const goWorkshop = () => {
    void runLocked(async ({ navigate }) => {
      const freshRoles = await getFreshRoles();

      /*
       * Redirectul automat către login este deja pornit.
       */
      if (freshRoles === null) {
        return;
      }

      if (!freshRoles.includes("workshop")) {
        navigate("/account?role=workshop");
        return;
      }

      localStorage.setItem("activeRole", "workshop");
      setActiveRole("workshop");

      navigate("/workshops/dashboard");
    });
  };

  const goMessages = () => {
    if (isWorkshopMode) {
      localStorage.setItem("activeRole", "workshop");
      navigate("/workshops/messages");
      return;
    }

    localStorage.setItem("activeRole", "customer");
    navigate("/customer/messages");
  };

  const goOffers = () => {
    void runLocked(async ({ navigate }) => {
      if (userId && appointmentProposalUnreadCount > 0) {
        const { error } = await supabase
          .from("notifications")
          .update({
            read_at: new Date().toISOString(),
          })
          .eq("recipient_id", userId)
          .is("read_at", null)
          .in("type", [
            "customer_proposed_appointment",
            "workshop_proposed_appointment",
          ]);

        if (error) {
          console.error(
            "Failed to mark appointment notifications as read:",
            error,
          );
        } else {
          setAppointmentProposalUnreadCount(0);
        }
      }

      if (isWorkshopMode) {
        localStorage.setItem("activeRole", "workshop");
        navigate("/workshops/my-offers");
        return;
      }

      localStorage.setItem("activeRole", "customer");
      navigate("/offers");
    });
  };

  const goJobs = () => {
    void runLocked(async ({ navigate }) => {
      if (userId && appointmentConfirmedUnreadCount > 0) {
        const { error } = await supabase
          .from("notifications")
          .update({
            read_at: new Date().toISOString(),
          })
          .eq("recipient_id", userId)
          .is("read_at", null)
          .in("type", [
            "customer_confirmed_appointment",
            "workshop_confirmed_appointment",
          ]);

        if (error) {
          console.error(
            "Failed to mark confirmed appointments as read:",
            error,
          );
        } else {
          setAppointmentConfirmedUnreadCount(0);
        }
      }

      if (isWorkshopMode) {
        localStorage.setItem("activeRole", "workshop");
        navigate("/workshops/won-jobs?tab=appointments");
        return;
      }

      localStorage.setItem("activeRole", "customer");
      navigate(
        progressUnreadCount > 0
          ? "/customer/my-jobs?tab=in_progress"
          : "/customer/my-jobs",
      );
    });
  };

  const openAppointmentToast = () => {
    const targetUrl = appointmentToast?.targetUrl;

    setAppointmentToast(null);

    if (targetUrl) {
      navigate(targetUrl);
    }
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="grid grid-cols-[auto_1fr] items-center gap-3 md:grid-cols-[auto_1fr_auto]">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black text-black shadow-sm">
            AR
          </div>

          <div className="min-w-0 text-center">
            <p
              className={`text-[10px] uppercase tracking-[0.26em] hidden sm:block ${
                isWorkshopMode ? "text-orange-400" : "text-white/80"
              }`}
            >
              {isWorkshopMode ? "PROFIL SERVICE" : "PROFIL CLIENT"}
            </p>

            <h1 className="truncate text-base font-bold leading-tight text-white">
              AutoRepair Marketplace
            </h1>

            <div className="mx-auto mt-4 flex w-fit rounded-full border border-white/10 bg-white/5 p-1 shadow-inner">
              <button
                type="button"
                onClick={goClient}
                disabled={isNavigating}
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isClientMode
                    ? "bg-white text-black shadow"
                    : "text-white/45 hover:text-white"
                }`}
              >
                Client
              </button>

              <button
                type="button"
                onClick={goWorkshop}
                disabled={isNavigating}
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  isWorkshopMode
                    ? "bg-orange-400 text-black shadow"
                    : "text-white/45 hover:text-white"
                }`}
              >
                Service
              </button>
            </div>
          </div>

          <div className="col-span-2 mt-2 flex w-full items-center justify-between px-2 md:col-span-1 md:mt-0 md:w-auto md:justify-end md:gap-2.5 md:px-0">
            <button
              type="button"
              onClick={goMessages}
              disabled={isNavigating}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Mesaje"
            >
              <MessageCircle size={17} strokeWidth={2.25} />
              {unreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={goOffers}
              disabled={isNavigating}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={isWorkshopMode ? "Ofertele tale" : "Oferte primite"}
            >
              <BadgeEuro size={18} strokeWidth={2.25} />

              {(isClientMode
                ? offerUnreadCount + appointmentProposalUnreadCount
                : appointmentProposalUnreadCount) > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                  {(isClientMode
                    ? offerUnreadCount + appointmentProposalUnreadCount
                    : appointmentProposalUnreadCount) > 9
                    ? "9+"
                    : isClientMode
                      ? offerUnreadCount + appointmentProposalUnreadCount
                      : appointmentProposalUnreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={goJobs}
              disabled={isNavigating}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={
                isWorkshopMode
                  ? "Lucrări câștigate și programări"
                  : "Lucrările și programările mele"
              }
            >
              <Wrench size={17} strokeWidth={2.25} />

              {isClientMode && progressUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-white">
                  {progressUnreadCount > 9 ? "9+" : progressUnreadCount}
                </span>
              )}

              {isWorkshopMode && wonJobsUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                  {wonJobsUnreadCount > 9 ? "9+" : wonJobsUnreadCount}
                </span>
              )}

              {appointmentConfirmedUnreadCount > 0 &&
                !(isClientMode && progressUnreadCount > 0) &&
                !(isWorkshopMode && wonJobsUnreadCount > 0) && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                    {appointmentConfirmedUnreadCount > 9
                      ? "9+"
                      : appointmentConfirmedUnreadCount}
                  </span>
                )}
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => navigate("/admin")}
                disabled={isNavigating}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-orange-400/40 text-orange-300 transition hover:bg-orange-400/10 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Admin Dashboard"
                title="Admin Dashboard"
              >
                <ShieldCheck size={17} strokeWidth={2.25} />
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                if (isWorkshopMode) {
                  localStorage.setItem("activeRole", "workshop");
                  navigate("/account?role=workshop");
                  return;
                }

                localStorage.setItem("activeRole", "customer");
                navigate("/account?role=customer");
              }}
              disabled={isNavigating}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10 disabled:opacity-40"
              aria-label="Setări"
            >
              <Settings size={17} strokeWidth={2.25} />
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-white transition hover:bg-white/10 disabled:opacity-40"
              aria-label="Ieșire"
              title="Ieșire"
            >
              <LogOut size={20} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>

      {isClientMode && showProgressToast && (
        <div className="fixed left-1/2 top-24 z-[999] w-[92%] max-w-sm -translate-x-1/2 rounded-3xl border border-orange-500/25 bg-black/90 px-4 py-3 text-white shadow-2xl backdrop-blur-xl">
          <p className="text-sm font-bold text-orange-300">
            🔧 Update nou de la service
          </p>
          <p className="mt-1 text-xs text-white/55">
            Ai primit un nou status sau poze pentru lucrarea ta.
          </p>
        </div>
      )}
      {appointmentToast && (
        <button
          type="button"
          onClick={openAppointmentToast}
          disabled={isNavigating}
          className="fixed left-1/2 top-24 z-[999] w-[92%] max-w-sm -translate-x-1/2 rounded-3xl border border-orange-500/25 bg-black/95 px-4 py-3 text-left text-white shadow-2xl backdrop-blur-xl disabled:cursor-not-allowed disabled:opacity-60"
        >
          <p className="text-sm font-bold text-orange-300">
            📅 {appointmentToast.title}
          </p>

          <p className="mt-1 text-xs leading-5 text-white/65">
            {appointmentToast.message}
          </p>
        </button>
      )}
    </nav>
  );
}
