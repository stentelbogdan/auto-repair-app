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
import { AsyncTimeoutError, withTimeout } from "@/lib/async/with-timeout";

type ActiveRole = "customer" | "workshop";

type AuthContextValue = {
  session: Session | null;
  user: Session["user"] | null;
  loading: boolean;
  activeRole: ActiveRole;
  setActiveRole: (role: ActiveRole) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_TIMEOUT_MS = 10_000;

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
      setActiveRoleState(savedRole);
    }

    const loadSession = async () => {
      try {
        const {
          data: { session },
        } = await withTimeout(
          supabase.auth.getSession(),
          SESSION_TIMEOUT_MS,
          "Session initialization",
        );

        setSession(session);
      } catch (error) {
        if (
          error instanceof AsyncTimeoutError &&
          process.env.NODE_ENV === "development"
        ) {
          console.warn("[AUTH] session:timeout");
        } else if (process.env.NODE_ENV === "development") {
          console.error("Failed to initialize auth session:", error);
        }
      } finally {
        setLoading(false);
      }
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
