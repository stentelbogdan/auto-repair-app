"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Role = "customer" | "workshop";

type Conversation = {
  requestId: string;
  offerId: string | null;
  title: string;
  city: string;
  status: string;
  image: string;
  workshopName: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
};

export default function MessagesInbox({ role }: { role: Role }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const currentUserIdRef = useRef<string>("");

  useEffect(() => {
    localStorage.setItem("activeRole", role);

    void loadConversations();

    const channel = supabase
      .channel(`messages-inbox-${role}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const newMessage = payload.new as {
            id: string;
            request_id: string;
            offer_id?: string | null;
            sender_id: string;
            sender_role: string;
            message?: string | null;
            images?: unknown[] | null;
            created_at: string;
          };

          const currentUserId = currentUserIdRef.current;

          setConversations((current) => {
            const conversationIndex = current.findIndex(
              (conversation) =>
                conversation.requestId === newMessage.request_id &&
                (conversation.offerId ?? null) ===
                  (newMessage.offer_id ?? null),
            );

            if (conversationIndex === -1) {
              /*
               * Este o conversație nouă care încă nu există în Inbox.
               * În cazul acesta facem un singur refresh.
               */
              void loadConversations(false);
              return current;
            }

            const conversation = current[conversationIndex];

            const isIncomingMessage =
              newMessage.sender_id !== currentUserId &&
              newMessage.sender_role !== "system";

            const hasImages =
              Array.isArray(newMessage.images) && newMessage.images.length > 0;

            const updatedConversation: Conversation = {
              ...conversation,

              lastMessage:
                newMessage.message?.trim() ||
                (hasImages ? "📷 Poză" : "Mesaj nou"),

              lastMessageTime: newMessage.created_at,

              unreadCount:
                conversation.unreadCount + (isIncomingMessage ? 1 : 0),
            };

            /*
             * Conversația cu mesaj nou urcă instant prima.
             */
            return [
              updatedConversation,
              ...current.filter((_, index) => index !== conversationIndex),
            ];
          });

          window.dispatchEvent(new Event("messages-read-updated"));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role]);

  const loadConversations = async (showLoader = true) => {
    try {
      if (showLoader) {
        setLoading(true);
      }

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const userId = authData.user.id;
      currentUserIdRef.current = userId;

      /*
       * Chatul trebuie să fie disponibil atât în perioada negocierii,
       * cât și după acceptarea ofertei.
       */
      let offersQuery = supabase
        .from("repair_offers")
        .select("*")
        .in("status", ["pending", "accepted"]);

      if (role === "workshop") {
        offersQuery = offersQuery.eq("workshop_user_id", userId);
      }

      const { data: offersData, error: offersError } = await offersQuery;
      if (offersError) throw offersError;

      const offers = offersData || [];

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

      let directRequestsQuery = supabase
        .from("repair_requests")
        .select("*")
        .eq("request_type", "direct_message");

      if (role === "workshop") {
        directRequestsQuery = directRequestsQuery.eq(
          "target_workshop_id",
          userId,
        );
      } else {
        directRequestsQuery = directRequestsQuery.eq("user_id", userId);
      }

      const { data: directRequestsData } = await directRequestsQuery;

      for (const request of directRequestsData || []) {
        const { data: messagesData } = await supabase
          .from("messages")
          .select("*")
          .eq("request_id", request.id)
          .is("offer_id", null)
          .order("created_at", { ascending: false });

        const messages = messagesData || [];
        const lastMessage = messages[0];
        const lastReadAt = readMap.get(request.id);

        const unreadCount = messages.filter((message: any) => {
          if (message.sender_id === userId) return false;
          if (message.sender_role === "system") return false;
          if (!lastReadAt) return true;

          return new Date(message.created_at) > new Date(lastReadAt);
        }).length;

        let workshopName = "Service";

        if (request.target_workshop_id) {
          const { data: workshopProfile } = await supabase
            .from("profiles")
            .select("workshop_name")
            .eq("id", request.target_workshop_id)
            .single();

          workshopName = workshopProfile?.workshop_name || "Service";
        }

        mapped.push({
          requestId: request.id,
          offerId: null,
          title: "Mesaj direct Service",
          city: "Conversație directă",
          status: request.status || "open",
          image: "",
          workshopName,
          lastMessage: lastMessage?.message || "Conversație începută",
          lastMessageTime: lastMessage?.created_at || request.created_at,
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
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-black px-4 py-6 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p
              className={`text-xs uppercase tracking-[0.28em] ${
                role === "workshop" ? "text-orange-400" : "text-white/50"
              }`}
            >
              Mesaje
            </p>

            <h1 className="mt-1 text-3xl font-black">Inbox</h1>
          </div>

          <button
            onClick={() =>
              router.push(
                role === "workshop"
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
              Conversațiile din oferte și lucrările acceptate vor apărea aici.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((conversation) => (
              <button
                key={`${conversation.requestId}-${conversation.offerId}`}
                onClick={() => {
                  localStorage.setItem("activeRole", role);

                  /*
                   * Din momentul în care utilizatorul deschide conversația,
                   * Inbox-ul o consideră citită local.
                   */
                  setConversations((current) =>
                    current.map((item) => {
                      const sameRequest =
                        item.requestId === conversation.requestId;

                      const sameOffer =
                        (item.offerId ?? null) ===
                        (conversation.offerId ?? null);

                      if (!sameRequest || !sameOffer) {
                        return item;
                      }

                      return {
                        ...item,
                        unreadCount: 0,
                      };
                    }),
                  );

                  router.push(
                    conversation.offerId
                      ? `/chat/${conversation.requestId}?offerId=${conversation.offerId}&role=${role}`
                      : `/chat/${conversation.requestId}?role=${role}`,
                  );
                }}
                className="flex w-full items-center gap-4 rounded-[26px] border border-white/10 bg-white/[0.04] p-4 text-left transition active:scale-[0.99] hover:bg-white/[0.07]"
              >
                <div className="relative h-16 w-16 shrink-0 overflow-visible">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl bg-white/10">
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
                  </div>

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
