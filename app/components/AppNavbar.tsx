"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<"client" | "workshop">("client");
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const loadUser = async () => {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        setUserEmail(null);
        return;
      }

      setUserEmail(authData.user.email ?? null);
    };

    loadUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      loadUser();
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  if (pathname === "/" || pathname === "/login") {
    return null;
  }

  const handleLogout = async () => {
    setLoggingOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      alert(error.message);
      setLoggingOut(false);
      return;
    }

    setUserEmail(null);
    router.push("/login");
    router.refresh();
    setLoggingOut(false);
  };

  const goClient = () => {
    setActiveMode("client");
    router.push("/customer/dashboard");
  };

  const goWorkshop = () => {
    setActiveMode("workshop");
    router.push("/workshops/dashboard");
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-bold text-black shadow-sm">
            AR
          </div>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-[10px] uppercase tracking-[0.24em] text-orange-400">
              {activeMode === "client" ? "PROFIL CLIENT" : "PROFIL SERVICE"}
            </p>

            <h1 className="mt-1 truncate text-base font-bold leading-tight text-white">
              AutoRepair Marketplace
            </h1>

            <div className="mx-auto mt-3 flex w-fit rounded-full border border-white/10 bg-white/5 p-1 shadow-inner">
              <button
                onClick={goClient}
                className={`rounded-full px-4 py-1.5 text-[11px] font-semibold transition ${
                  activeMode === "client"
                    ? "bg-white text-black shadow"
                    : "text-white/55 hover:text-white"
                }`}
              >
                Client
              </button>

              <button
                onClick={goWorkshop}
                className={`rounded-full px-4 py-1.5 text-[11px] font-semibold transition ${
                  activeMode === "workshop"
                    ? "bg-orange-400 text-black shadow"
                    : "text-white/55 hover:text-white"
                }`}
              >
                Service
              </button>
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-center gap-2">
            <button
              onClick={handleLogout}
              disabled={!userEmail || loggingOut}
              className="rounded-full border border-white/20 px-4 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40"
            >
              {loggingOut ? "..." : "Ieșire"}
            </button>

            <button
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