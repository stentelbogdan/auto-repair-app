"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-provider";
import { supabase } from "@/lib/supabase/client";

type ViewerRoleState = {
  userId: string;
  roles: string[];
};

export default function WorkshopProfileActions({
  workshopId,
}: {
  workshopId: string;
}) {
  const router = useRouter();
  const { user, loading, activeRole } = useAuth();
  const [viewerRoleState, setViewerRoleState] =
    useState<ViewerRoleState | null>(null);
  const authenticatedUserId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    if (loading || !authenticatedUserId) {
      return;
    }

    const userId = authenticatedUserId;

    const loadViewerRoles = async () => {
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle<{ role: string[] | null }>();

      if (cancelled) {
        return;
      }

      if (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("Failed to load public profile viewer roles:", error);
        }

        setViewerRoleState({ userId, roles: [] });
        return;
      }

      setViewerRoleState({
        userId,
        roles: Array.isArray(profile?.role) ? profile.role : [],
      });
    };

    void loadViewerRoles();

    return () => {
      cancelled = true;
    };
  }, [authenticatedUserId, loading]);

  const handleRequestOffer = () => {
    router.push(`/post-choice?targetWorkshopId=${workshopId}`);
  };

  const handleSendMessage = async () => {
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      router.push("/login");
      return;
    }

    const { data: existingRequest } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("target_workshop_id", workshopId)
      .eq("request_type", "direct_message")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRequest?.id) {
      router.push(`/chat/${existingRequest.id}?role=customer`);
      return;
    }

    router.push(
      `/chat/draft?draft=1&directWorkshopId=${encodeURIComponent(workshopId)}&role=customer`,
    );
  };

  const canUseCustomerActions =
    !loading &&
    !!user &&
    viewerRoleState?.userId === user.id &&
    viewerRoleState.roles.includes("customer") &&
    activeRole === "customer";

  if (!canUseCustomerActions) {
    return null;
  }

  return (
    <div className="mt-8 flex flex-col gap-3 md:flex-row">
      <button
        type="button"
        onClick={handleRequestOffer}
        className="flex-1 rounded-2xl bg-orange-500 px-6 py-4 text-base font-black text-black transition hover:bg-orange-400"
      >
        Solicită ofertă
      </button>

      <button
        type="button"
        onClick={handleSendMessage}
        className="flex-1 rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-base font-bold text-white transition hover:bg-white/10"
      >
        Trimite mesaj
      </button>
    </div>
  );
}
