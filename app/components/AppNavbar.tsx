"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [unreadCount, setUnreadCount] = useState(3);

  const isWorkshopMode = pathname.startsWith("/workshops");
  const isClientMode = !isWorkshopMode;

  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (mounted) {
        setUserEmail(session?.user?.email ?? null);
        setUserId(session?.user?.id ?? null);
      }
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user?.email ?? null);
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      return;
    }

    const loadUnreadMessages = async () => {
      const { data, error } = await supabase.rpc("get_unread_messages_count");

      if (error) {
        console.error("Failed to load unread count:", error);
        setUnreadCount(0);
        return;
      }

      setUnreadCount(data || 0);
    };

    loadUnreadMessages();

    const channel = supabase
      .channel(`navbar-unread-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
        },
        () => {
          loadUnreadMessages();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_reads",
        },
        () => {
          loadUnreadMessages();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  if (pathname === "/" || pathname === "/login") {
    return null;
  }

  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      localStorage.removeItem("activeRole");

      await supabase.auth.signOut();

      setUserEmail(null);
      setUserId(null);
      setUnreadCount(0);

      setTimeout(() => {
        window.location.href = "/login";
      }, 100);
    } catch (error: any) {
      console.error("Logout failed:", error);
      window.location.href = "/login";
    }
  };

  const goClient = () => {
    localStorage.setItem("activeRole", "customer");
    router.push("/customer/dashboard");
  };

  const goWorkshop = () => {
    localStorage.setItem("activeRole", "workshop");
    router.push("/workshops/dashboard");
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-sm font-black text-black shadow-sm">
            AR
            {unreadCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black leading-none text-white shadow-lg ring-2 ring-black">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
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

            <button
              type="button"
              onClick={() => router.push("/account")}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-sm text-white transition hover:bg-white/10"
            >
              ⚙
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
