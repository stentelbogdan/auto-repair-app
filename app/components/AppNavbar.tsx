"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  MessageCircle,
  Wrench,
  Settings,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { BadgeEuro } from "lucide-react";
import { useGLTF } from "@react-three/drei";

type Role = "customer" | "workshop";

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  useEffect(() => {
    useGLTF.preload("/models/autorepair-car.glb");
  }, []);
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

    const loadUnreadMessages = async () => {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        setUnreadCount(0);
        return;
      }

      const currentUserId = authData.user.id;
      let requestIds: string[] = [];

      if (isWorkshopMode) {
        const { data: directRequests } = await supabase
          .from("repair_requests")
          .select("id")
          .eq("target_workshop_id", currentUserId);

        const { data: wonOffers } = await supabase
          .from("repair_offers")
          .select("request_id")
          .eq("workshop_user_id", currentUserId)
          .eq("status", "accepted");

        requestIds = [
          ...(directRequests || []).map((request) => request.id),
          ...(wonOffers || []).map((offer) => offer.request_id),
        ];
      } else {
        const { data: customerRequests } = await supabase
          .from("repair_requests")
          .select("id")
          .eq("user_id", currentUserId);

        requestIds = (customerRequests || []).map((request) => request.id);
      }

      requestIds = Array.from(new Set(requestIds)).filter(Boolean);

      if (requestIds.length === 0) {
        setUnreadCount(0);
        return;
      }

      const { data: readsData } = await supabase
        .from("conversation_reads")
        .select("request_id, last_read_at")
        .eq("user_id", currentUserId);

      const readMap = new Map<string, string>();

      (readsData || []).forEach((read: any) => {
        readMap.set(read.request_id, read.last_read_at);
      });

      const { data: messagesData, error: messagesError } = await supabase
        .from("messages")
        .select("id, request_id, sender_id, sender_role, created_at")
        .in("request_id", requestIds);

      if (messagesError) {
        console.error("Failed to load unread messages:", messagesError);
        setUnreadCount(0);
        return;
      }

      const count = (messagesData || []).filter((message: any) => {
        if (message.sender_id === currentUserId) return false;
        if (message.sender_role === "system") return false;

        const lastReadAt = readMap.get(message.request_id);

        if (!lastReadAt) return true;

        return new Date(message.created_at) > new Date(lastReadAt);
      }).length;

      setUnreadCount(count);
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

    loadUnreadMessages();
    loadUnreadProgress();
    loadUnreadOffers();
    loadUnreadWonJobs();
    loadUnreadDirectRequests();
    loadUnreadAppointmentNotifications();

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
        async () => {
          await loadUnreadMessages();
        },
      )

      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_reads",
        },
        async () => {
          await loadUnreadMessages();
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

      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          loadUnreadMessages();
          loadUnreadProgress();
          loadUnreadOffers();
          loadUnreadWonJobs();
          loadUnreadDirectRequests();
          loadUnreadOpenRequests();
          loadUnreadAppointmentNotifications();
        }
      });

    const refreshBadges = () => {
      loadUnreadMessages();
      loadUnreadProgress();
      loadUnreadOffers();
      loadUnreadWonJobs();
      loadUnreadDirectRequests();
      loadUnreadOpenRequests();
      loadUnreadAppointmentNotifications();
    };

    window.addEventListener("focus", refreshBadges);
    window.addEventListener("messages-read-updated", refreshBadges);
    window.addEventListener("progress-read-updated", refreshBadges);
    window.addEventListener("offers-read-updated", refreshBadges);
    window.addEventListener("direct-requests-read-updated", refreshBadges);
    window.addEventListener("notifications-read-updated", refreshBadges);

    return () => {
      window.removeEventListener("focus", refreshBadges);
      window.removeEventListener("messages-read-updated", refreshBadges);
      window.removeEventListener("progress-read-updated", refreshBadges);
      window.removeEventListener("offers-read-updated", refreshBadges);
      window.removeEventListener("direct-requests-read-updated", refreshBadges);
      window.removeEventListener("notifications-read-updated", refreshBadges);

      supabase.removeChannel(channel);
    };
  }, [userId, isWorkshopMode, isClientMode]);

  if (pathname === "/" || pathname === "/login") {
    return null;
  }

  const handleLogout = async () => {
    setLoggingOut(true);

    localStorage.removeItem("activeRole");
    await supabase.auth.signOut();

    window.location.href = "/login";
  };

  const getFreshRoles = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return [];
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

  const goClient = async () => {
    const freshRoles = await getFreshRoles();

    if (!freshRoles.includes("customer")) {
      router.push("/account?role=customer");
      return;
    }

    localStorage.setItem("activeRole", "customer");
    setActiveRole("customer");
    router.push("/customer/dashboard");
  };

  const goWorkshop = async () => {
    const freshRoles = await getFreshRoles();

    if (!freshRoles.includes("workshop")) {
      router.push("/account?role=workshop");
      return;
    }

    localStorage.setItem("activeRole", "workshop");
    setActiveRole("workshop");
    router.push("/workshops/dashboard");
  };

  const goMessages = () => {
    if (isWorkshopMode) {
      localStorage.setItem("activeRole", "workshop");
      window.location.href = "/workshops/messages";
      return;
    }

    localStorage.setItem("activeRole", "customer");
    window.location.href = "/customer/messages";
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
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition ${
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
                className={`rounded-full px-4 py-1.5 text-[11px] font-bold transition ${
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
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
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
              onClick={async () => {
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
                  router.push("/workshops/my-offers");
                  return;
                }

                localStorage.setItem("activeRole", "customer");
                router.push("/offers");
              }}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
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
              onClick={async () => {
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
                  router.push("/workshops/won-jobs?tab=appointments");
                  return;
                }

                router.push("/customer/my-jobs");
              }}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
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
                onClick={() => router.push("/admin")}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-orange-400/40 text-orange-300 transition hover:bg-orange-400/10"
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
                  router.push("/account?role=workshop");
                  return;
                }

                localStorage.setItem("activeRole", "customer");
                router.push("/account?role=customer");
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
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
          onClick={() => {
            const targetUrl = appointmentToast.targetUrl;

            setAppointmentToast(null);

            if (targetUrl) {
              router.push(targetUrl);
            }
          }}
          className="fixed left-1/2 top-24 z-[999] w-[92%] max-w-sm -translate-x-1/2 rounded-3xl border border-orange-500/25 bg-black/95 px-4 py-3 text-left text-white shadow-2xl backdrop-blur-xl"
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
