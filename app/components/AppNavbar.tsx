"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Role = "customer" | "workshop";

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [progressUnreadCount, setProgressUnreadCount] = useState(0);
  const [activeRole, setActiveRole] = useState<Role>("customer");
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [roleParam, setRoleParam] = useState<Role | null>(null);
  const lastProgressCountRef = useRef(0);
  const [showProgressToast, setShowProgressToast] = useState(false);

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
      return;
    }

    const loadUnreadMessages = async () => {
      const { data, error } = await supabase.rpc("get_unread_messages_count");

      if (error) {
        console.error("Failed to load unread count:", error);
        setUnreadCount(0);
        return;
      }

      setUnreadCount(Number(data || 0));
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

    loadUnreadMessages();
    loadUnreadProgress();

    const channel = supabase
      .channel(`navbar-live-badges-${userId}`)

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
        }
      });

    const refreshBadges = () => {
      loadUnreadMessages();
      loadUnreadProgress();
    };

    window.addEventListener("focus", refreshBadges);
    window.addEventListener("messages-read-updated", refreshBadges);
    window.addEventListener("progress-read-updated", refreshBadges);

    return () => {
      window.removeEventListener("focus", refreshBadges);
      window.removeEventListener("messages-read-updated", refreshBadges);
      window.removeEventListener("progress-read-updated", refreshBadges);

      supabase.removeChannel(channel);
    };
  }, [userId]);

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
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black text-black shadow-sm">
            AR
          </div>

          <div className="min-w-0 text-center">
            <p
              className={`text-[10px] uppercase tracking-[0.26em] ${
                isWorkshopMode ? "text-orange-400" : "text-white/80"
              }`}
            >
              {isWorkshopMode ? "PROFIL SERVICE" : "PROFIL CLIENT"}
            </p>

            <h1 className="mt-1 truncate text-base font-bold leading-tight text-white">
              AutoRepair Marketplace
            </h1>

            <div className="mx-auto mt-3 flex w-fit rounded-full border border-white/10 bg-white/5 p-1 shadow-inner">
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

          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-full border border-white/20 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40"
            >
              {loggingOut ? "..." : "Ieșire"}
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goMessages}
                className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
                aria-label="Mesaje"
              >
                💬
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black leading-none text-white shadow-lg ring-2 ring-black">
                    {unreadCount > 9 ? "9+" : unreadCount}
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
                className="relative flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
              >
                🔧
                {isClientMode && progressUnreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-black leading-none text-white shadow-lg ring-2 ring-black">
                    {progressUnreadCount > 9 ? "9+" : progressUnreadCount}
                  </span>
                )}
              </button>

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
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
                aria-label="Setări"
              >
                ⚙
              </button>
            </div>
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
