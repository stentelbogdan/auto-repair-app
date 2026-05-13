"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Role = "customer" | "workshop";

type Conversation = {
  requestId: string;
  offerId: string;
  title: string;
  city: string;
  status: string;
  image: string;
  workshopName: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
};

export default function MessagesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = searchParams.get("role");

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeRole, setActiveRole] = useState<Role | null>(null);

  useEffect(() => {
    const role: Role =
      roleParam === "workshop" || roleParam === "customer"
        ? roleParam
        : localStorage.getItem("activeRole") === "workshop"
          ? "workshop"
          : "customer";

    localStorage.setItem("activeRole", role);
    setActiveRole(role);
    setLoading(true);
    loadConversations(role);
  }, [roleParam]);

  const loadConversations = async (role: Role) => {
    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const userId = authData.user.id;

      let offersQuery = supabase
        .from("repair_offers")
        .select("*")
        .eq("status", "accepted");

      if (role === "workshop") {
        offersQuery = offersQuery.eq("workshop_user_id", userId);
      }

      const { data: offersData, error: offersError } = await offersQuery;

      if (offersError) throw offersError;

      const offers = offersData || [];

      if (offers.length === 0) {
        setConversations([]);
        return;
      }

      const requestIds = offers.map((offer: any) => offer.request_id);

      let requestsQuery = supabase
        .from("repair_requests")
        .select("*")
        .in("id", requestIds);

      if (role === "customer") {
        requestsQuery = requestsQuery.eq("user_id", userId);
      }

      const { data: requestsData, error: requestsError } = await requestsQuery;

      if (requestsError) throw requestsError;

      const requests = requestsData || [];
      const requestMap = new Map(
        requests.map((request: any) => [request.id, request]),
      );

      const { data: readsData } = await supabase
        .from("conversation_reads")
        .select("request_id, last_read_at")
        .eq("user_id", userId);

      const readMap = new Map<string, string>();

      (readsData || []).forEach((read: any) => {
        readMap.set(read.request_id, read.last_read_at);
      });

      const mapped: Conversation[] = [];

      for (const offer of offers) {
        const request = requestMap.get(offer.request_id);

        if (!request) continue;

        const { data: messagesData } = await supabase
          .from("messages")
          .select("*")
          .eq("request_id", offer.request_id)
          .eq("offer_id", offer.id)
          .order("created_at", { ascending: false });

        const messages = messagesData || [];
        const lastMessage = messages[0];
        const lastReadAt = readMap.get(offer.request_id);

        const unreadCount = messages.filter((message: any) => {
          if (message.sender_id === userId) return false;
          if (message.sender_role === "system") return false;
          if (!lastReadAt) return true;

          return new Date(message.created_at) > new Date(lastReadAt);
        }).length;

        const image =
          request.images?.[0]?.url || request.images?.[0]?.dataUrl || "";

        mapped.push({
          requestId: request.id,
          offerId: offer.id,
          title: `${request.car_brand || "Lucrare"} ${request.car_model || ""}`,
          city: request.city || "-",
          status: request.status || "matched",
          image,
          workshopName: offer.workshop_name || "Service",
          lastMessage: lastMessage?.message || "Conversație începută",
          lastMessageTime: lastMessage?.created_at || offer.created_at,
          unreadCount,
        });
      }

      mapped.sort(
        (a, b) =>
          new Date(b.lastMessageTime).getTime() -
          new Date(a.lastMessageTime).getTime(),
      );

      setConversations(mapped);
    } catch (error) {
      console.error("Failed to load conversations:", error);
      setConversations([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p
              className={`text-xs uppercase tracking-[0.28em] ${
                activeRole === "workshop" ? "text-orange-400" : "text-white/50"
              }`}
            >
              Mesaje
            </p>

            <h1 className="mt-1 text-3xl font-black">Inbox</h1>
          </div>

          <button
            onClick={() =>
              router.push(
                activeRole === "workshop"
                  ? "/workshops/dashboard"
                  : "/customer/dashboard",
              )
            }
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white"
          >
            Dashboard
          </button>
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8 text-center text-white/55">
            Se încarcă mesajele...
          </div>
        ) : conversations.length === 0 ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-3xl text-black">
              💬
            </div>
            <h2 className="text-2xl font-bold">Nu ai conversații încă</h2>
            <p className="mt-2 text-white/55">
              Când apare o lucrare acceptată, conversația va apărea aici.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => (
              <button
                key={`${conversation.requestId}-${conversation.offerId}`}
                onClick={() =>
                  router.push(
                    `/chat/${conversation.requestId}?offerId=${conversation.offerId}`,
                  )
                }
                className="flex w-full items-center gap-4 rounded-[26px] border border-white/10 bg-white/[0.04] p-4 text-left transition active:scale-[0.99] hover:bg-white/[0.07]"
              >
                <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-white/10">
                  {conversation.image ? (
                    <img
                      src={conversation.image}
                      alt={conversation.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs font-bold text-white/40">
                      AR
                    </div>
                  )}

                  {conversation.unreadCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-black text-white ring-2 ring-black">
                      {conversation.unreadCount > 9
                        ? "9+"
                        : conversation.unreadCount}
                    </span>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-black">
                        {conversation.title}
                      </h2>
                      <p className="mt-0.5 text-sm text-white/45">
                        {conversation.city} •{" "}
                        {formatStatus(conversation.status)}
                      </p>
                    </div>

                    <span className="shrink-0 text-xs text-white/35">
                      {formatTime(conversation.lastMessageTime)}
                    </span>
                  </div>

                  <p
                    className={`mt-2 truncate text-sm ${
                      conversation.unreadCount > 0
                        ? "font-semibold text-white"
                        : "text-white/45"
                    }`}
                  >
                    {conversation.lastMessage}
                  </p>

                  <p className="mt-1 text-xs text-orange-400/80">
                    {conversation.workshopName}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatStatus(status?: string | null) {
  switch (status) {
    case "matched":
      return "Acceptată";
    case "in_progress":
      return "În lucru";
    case "completed":
      return "Finalizată";
    default:
      return "Deschisă";
  }
}

function formatTime(date?: string | null) {
  if (!date) return "";

  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
