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
  { href: "/", label: "Post a job", roles: ["customer"] },
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

        let profile: ProfileRow | null = null;

        const { data: profileById, error: profileByIdError } = await supabase
          .from("profiles")
          .select("email, role")
          .eq("id", authUser.id)
          .single<ProfileRow>();

        if (!profileByIdError && profileById) {
          profile = profileById;
        } else if (authEmail) {
          const { data: profileByEmail, error: profileByEmailError } =
            await supabase
              .from("profiles")
              .select("email, role")
              .eq("email", authEmail)
              .single<ProfileRow>();

          if (!profileByEmailError && profileByEmail) {
            profile = profileByEmail;
          }
        }

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
    if (href === "/") return pathname === "/";
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

  const renderRoleSwitcher = () => {
    if (!userEmail || loadingProfile || !roles.length) return null;

    return (
      <div className="flex flex-wrap gap-2">
        {roles.includes("customer") && (
          <button
            onClick={() => router.push("/")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              pathname === "/"
                ? "bg-white text-black"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            Customer
          </button>
        )}

        {roles.includes("workshop") && (
  <button
    onClick={() => router.push("/workshops/dashboard")}
    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
      pathname.startsWith("/workshops")
        ? "bg-white text-black"
        : "bg-white/10 text-white hover:bg-white/20"
    }`}
  >
    Workshop
  </button>
)}

        {roles.includes("admin") && (
          <button
            onClick={() => router.push("/admin")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition ${
              pathname.startsWith("/admin")
                ? "bg-white text-black"
                : "bg-white/10 text-white hover:bg-white/20"
            }`}
          >
            Admin
          </button>
        )}
      </div>
    );
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-4">
        <div className="flex items-start justify-between gap-6">
          <Link href="/" className="shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white text-sm font-bold text-black">
                AR
              </div>

              <div className="hidden sm:block">
                <p className="text-sm font-semibold text-white">
                  AutoRepair Marketplace
                </p>
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                  MVP
                </p>
              </div>
            </div>
          </Link>

          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {visibleNavItems.map((item) => {
                const active = isActive(item.href);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition ${
                      active
                        ? "bg-white text-black"
                        : "bg-white/10 text-white hover:bg-white/30"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>

            {renderRoleSwitcher()}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-white/40">
                  Signed in as
                </p>
                <p className="mt-1 text-sm font-medium text-white">
                  {userEmail || "Guest"}
                </p>
                <p className="mt-1 text-xs text-white/55">
                  Access: {rolesLabel}
                </p>
              </div>

              <button
                onClick={handleLogout}
                disabled={!userEmail || loggingOut}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loggingOut ? "Logging out..." : "Logout"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}