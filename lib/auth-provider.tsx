"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { ensureAuthenticatedWorkshopSlug } from "@/lib/workshops/workshop-slug";

type ActiveRole = "customer" | "workshop";

type AuthContextValue = {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
  activeRole: ActiveRole;
  setActiveRole: (role: ActiveRole) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeRoleState, setActiveRoleState] =
    useState<ActiveRole>("customer");
  const reconciledWorkshopSlugUserIdsRef = useRef(new Set<string>());

  useEffect(() => {
    const savedRole = localStorage.getItem("activeRole");

    if (savedRole === "workshop" || savedRole === "customer") {
      // Browser storage is only available after this client component hydrates.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveRoleState(savedRole);
    }

    const loadSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);
      setLoading(false);
    };

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (
      !userId ||
      reconciledWorkshopSlugUserIdsRef.current.has(userId)
    ) {
      return;
    }

    reconciledWorkshopSlugUserIdsRef.current.add(userId);

    void ensureAuthenticatedWorkshopSlug(userId).catch((error) => {
      console.error("Failed to reconcile workshop public profile slug:", error);
    });
  }, [userId]);

  const setActiveRole = (role: ActiveRole) => {
    localStorage.setItem("activeRole", role);
    setActiveRoleState(role);
  };

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      activeRole: activeRoleState,
      setActiveRole,
    }),
    [session, loading, activeRoleState]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
