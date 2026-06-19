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
import { FileText } from "lucide-react";
import { ClipboardList } from "lucide-react";

type Role = "customer" | "workshop";

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");

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
      localStorage.setItem("activeRole", "customer");
      setActiveRole("customer");
      return;
    }

    const savedRole = localStorage.getItem("activeRole");

    if (savedRole === "workshop" || savedRole === "customer") {
      setActiveRole(savedRole);
    }
  }, [pathname, roleParam]);

  const isWorkshopMode =
    pathname.startsWith("/workshops") ||
    roleParam === "workshop" ||
    (pathname.startsWith("/chat") && activeRole === "workshop");

  const isClientMode =
    pathname.startsWith("/customer") ||
    roleParam === "customer" ||
    !isWorkshopMode;

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
      return;
    }

    const loadUnreadMessages = async () => {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        setUnreadCount(0);
        return;
      }

      const currentUserId = authData.user.id;

      let requestsQuery = supabase.from("repair_requests").select("id");

      if (isWorkshopMode) {
        requestsQuery = requestsQuery.eq("target_workshop_id", currentUserId);
      } else {
        requestsQuery = requestsQuery.eq("user_id", currentUserId);
      }

      const { data: requestsData, error: requestsError } = await requestsQuery;

      if (requestsError || !requestsData?.length) {
        setUnreadCount(0);
        return;
      }

      const requestIds = requestsData.map((request) => request.id);

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

    loadUnreadMessages();
    loadUnreadProgress();
    loadUnreadOffers();

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

      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          loadUnreadMessages();
          loadUnreadProgress();
          loadUnreadOffers();
        }
      });

    const refreshBadges = () => {
      loadUnreadMessages();
      loadUnreadProgress();
      loadUnreadOffers();
    };

    window.addEventListener("focus", refreshBadges);
    window.addEventListener("messages-read-updated", refreshBadges);
    window.addEventListener("progress-read-updated", refreshBadges);
    window.addEventListener("offers-read-updated", refreshBadges);

    return () => {
      window.removeEventListener("focus", refreshBadges);
      window.removeEventListener("messages-read-updated", refreshBadges);
      window.removeEventListener("progress-read-updated", refreshBadges);
      window.removeEventListener("offers-read-updated", refreshBadges);

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
    const goProgress = () => {
      if (isWorkshopMode) {
        localStorage.setItem("activeRole", "workshop");
        window.location.href = "/workshops/won-jobs";
        return;
      }

      localStorage.setItem("activeRole", "customer");
      window.location.href = "/customer/my-jobs";
    };
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
              onClick={() => {
                localStorage.setItem("activeRole", "customer");
                router.push("/offers");
              }}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
              aria-label="Oferte primite"
            >
              <BadgeEuro size={18} strokeWidth={2.25} />
              {isClientMode && offerUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
                  {offerUnreadCount > 9 ? "9+" : offerUnreadCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                if (isWorkshopMode) {
                  router.push("/workshops/won-jobs");
                  return;
                }

                router.push("/customer/my-jobs");
              }}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
            >
              <Wrench size={17} strokeWidth={2.25} />
              {isClientMode && progressUnreadCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white">
                  {progressUnreadCount > 9 ? "9+" : progressUnreadCount}
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
    </nav>
  );
}
