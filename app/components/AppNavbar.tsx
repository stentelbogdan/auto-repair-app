"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  email: string | null;
  role: string[] | null;
};

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  const [userEmail, setUserEmail] = useState<string | null>(null);
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

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-sm font-bold text-black">
            AR
          </div>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-[11px] uppercase tracking-[0.22em] text-orange-400">
              Customer dashboard
            </p>
            <h1 className="mt-1 truncate text-base font-bold leading-tight text-white">
              AutoRepair Marketplace
            </h1>
            <p className="mt-1 truncate text-[11px] text-white/50">
              Manage requests, offers and booked repairs
            </p>
          </div>

          <button
            onClick={handleLogout}
            disabled={!userEmail || loggingOut}
            className="shrink-0 rounded-full border border-white/20 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40"
          >
            {loggingOut ? "..." : "Logout"}
          </button>
        </div>
      </div>
    </nav>
  );
}