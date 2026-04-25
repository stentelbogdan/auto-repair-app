"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";

type NavItem = {
  href: string;
  label: string;
  requiresAuth?: boolean;
  roles?: string[];
};

const navItems: NavItem[] = [
  { href: "/customer/dashboard", label: "Dashboard", roles: ["customer"] },
  { href: "/workshops", label: "Find jobs", roles: ["workshop"] },
  { href: "/offers", label: "My offers", roles: ["customer"] },
  { href: "/admin", label: "Admin", roles: ["admin"] },
  { href: "/account", label: "Account", requiresAuth: true },
];

type ProfileRow = {
  email: string | null;
  role: string[] | null;
};

export default function AppNavbar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/" || pathname === "/login") {
    return null;
  }

  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [loggingOut, setLoggingOut] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  useEffect(() => {
    const loadUser = async () => {
      setLoadingProfile(true);

      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          setUserEmail(null);
          setRoles([]);
          setLoadingProfile(false);
          return;
        }

        const authUser = authData.user;
        const authEmail = authUser.email ?? null;

        setUserEmail(authEmail);

        const { data: profile } = await supabase
          .from("profiles")
          .select("email, role")
          .eq("id", authUser.id)
          .single<ProfileRow>();

        setRoles(Array.isArray(profile?.role) ? profile.role : []);
      } catch (error) {
        console.error("Navbar profile load failed:", error);
        setRoles([]);
      } finally {
        setLoadingProfile(false);
      }
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

  const handleLogout = async () => {
    setLoggingOut(true);

    try {
      const { error } = await supabase.auth.signOut();

      if (error) {
        alert(error.message);
        return;
      }

      setUserEmail(null);
      setRoles([]);
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
      alert("Something went wrong during logout.");
    } finally {
      setLoggingOut(false);
    }
  };

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const rolesLabel = useMemo(() => {
    if (loadingProfile) return "Loading...";
    if (!roles.length) return "Guest";
    return roles.join(" • ");
  }, [roles, loadingProfile]);

  const visibleNavItems = useMemo(() => {
    if (!userEmail) return navItems.filter((item) => !item.requiresAuth);
    if (loadingProfile) return navItems.filter((item) => item.requiresAuth);

    return navItems.filter((item) => {
      if (item.requiresAuth && !userEmail) return false;
      if (!item.roles) return true;
      return item.roles.some((r) => roles.includes(r));
    });
  }, [roles, userEmail, loadingProfile]);

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/90 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/customer/dashboard" className="shrink-0">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-sm font-bold text-black">
              AR
            </div>
          </Link>

          <div className="flex flex-1 items-center gap-2 overflow-x-auto">
            {visibleNavItems.map((item) => {
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-white text-black"
                      : "bg-white/10 text-white hover:bg-white/20"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          <button
            onClick={handleLogout}
            disabled={!userEmail || loggingOut}
            className="shrink-0 rounded-full border border-white/15 px-3 py-2 text-xs font-medium text-white/80 disabled:opacity-40"
          >
            {loggingOut ? "..." : "Logout"}
          </button>
        </div>

        {userEmail && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-white/45">
            <p className="truncate">{userEmail}</p>
            <p className="shrink-0">{rolesLabel}</p>
          </div>
        )}
      </div>
    </nav>
  );
}