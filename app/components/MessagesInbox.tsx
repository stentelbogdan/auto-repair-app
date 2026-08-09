"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

type OfferRow = {
  id: string;
  request_id: string;
  workshop_user_id: string | null;
  workshop_name: string | null;
  status: string | null;
  created_at: string;
};

type RequestImage = {
  url?: string | null;
  dataUrl?: string | null;
};

type RequestRow = {
  id: string;
  user_id: string;
  car_brand: string | null;
  car_model: string | null;
  city: string | null;
  status: string | null;
  images: RequestImage[] | null;
  request_type: string | null;
  target_workshop_id: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  request_id: string;
  offer_id: string | null;
  sender_id: string;
  sender_role: string;
  message: string | null;
  images: unknown[] | null;
  created_at: string;
  read_at: string | null;
};

type ProfileRow = {
  id: string;
  workshop_name: string | null;
};

function getConversationKey(requestId: string, offerId: string | null) {
  return `${requestId}::${offerId ?? "direct"}`;
}

function getLastMessageText(message?: Pick<MessageRow, "message" | "images"> | null) {
  if (!message) {
    return "Conversație începută";
  }

  const text = message.message?.trim();

  if (text) {
    return text;
  }

  return Array.isArray(message.images) && message.images.length > 0
    ? "📷 Poză"
    : "Mesaj nou";
}

export default function MessagesInbox({ role }: { role: Role }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const currentUserIdRef = useRef<string>("");
  const perfStartRef = useRef<number>(performance.now());

  const logPerf = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      const elapsed = (performance.now() - perfStartRef.current).toFixed(1);
      console.log("[MSG-PERF][Inbox]", {
        event,
        elapsedMs: Number(elapsed),
        role,
        ...details,
      });
    },
    [role],
  );

  const loadConversations = useCallback(
    async (showLoader = true) => {
      try {
        logPerf("loadConversations:start", { showLoader });

        if (showLoader) {
          setLoading(true);
        }

        const authStart = performance.now();
        logPerf("auth.getUser:start");
        const { data: authData } = await supabase.auth.getUser();
        logPerf("auth.getUser:end", {
          durationMs: Number((performance.now() - authStart).toFixed(1)),
          hasUser: Boolean(authData.user),
        });

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const userId = authData.user.id;
        currentUserIdRef.current = userId;

        let offersQuery = supabase
          .from("repair_offers")
          .select(
            "id, request_id, workshop_user_id, workshop_name, status, created_at",
          )
          .in("status", ["pending", "accepted"]);

        if (role === "workshop") {
          offersQuery = offersQuery.eq("workshop_user_id", userId);
        }

        let directRequestsQuery = supabase
          .from("repair_requests")
          .select(
            "id, user_id, car_brand, car_model, city, status, images, request_type, target_workshop_id, created_at",
          )
          .eq("request_type", "direct_message");

        if (role === "workshop") {
          directRequestsQuery = directRequestsQuery.eq(
            "target_workshop_id",
            userId,
          );
        } else {
          directRequestsQuery = directRequestsQuery.eq("user_id", userId);
        }

        const offersStart = performance.now();
        const directRequestsStart = performance.now();
        logPerf("query:repair_offers:start");
        logPerf("query:direct_requests:start");
        const [
          { data: offersData, error: offersError },
          { data: directRequestsData, error: directRequestsError },
        ] = await Promise.all([offersQuery, directRequestsQuery]);
        logPerf("query:repair_offers:end", {
          durationMs: Number((performance.now() - offersStart).toFixed(1)),
          count: offersData?.length || 0,
        });
        logPerf("query:direct_requests:end", {
          durationMs: Number(
            (performance.now() - directRequestsStart).toFixed(1),
          ),
          count: directRequestsData?.length || 0,
        });

        if (offersError) throw offersError;
        if (directRequestsError) throw directRequestsError;

        const offers = (offersData || []) as OfferRow[];
        const directRequests = (directRequestsData || []) as RequestRow[];

        const offerRequestIds = [...new Set(offers.map((offer) => offer.request_id))];

        let requests: RequestRow[] = [];

        if (offerRequestIds.length > 0) {
          const requestsStart = performance.now();
          logPerf("query:repair_requests_for_offers:start", {
            requestIds: offerRequestIds.length,
          });
          let requestsQuery = supabase
            .from("repair_requests")
            .select(
              "id, user_id, car_brand, car_model, city, status, images, request_type, target_workshop_id, created_at",
            )
            .in("id", offerRequestIds);

          if (role === "customer") {
            requestsQuery = requestsQuery.eq("user_id", userId);
          }

          const { data: requestsData, error: requestsError } = await requestsQuery;
          logPerf("query:repair_requests_for_offers:end", {
            durationMs: Number((performance.now() - requestsStart).toFixed(1)),
            count: requestsData?.length || 0,
          });
          if (requestsError) throw requestsError;
          requests = (requestsData || []) as RequestRow[];
        }

        const allRequests = [...requests, ...directRequests];
        const requestMap = new Map(allRequests.map((request) => [request.id, request]));

        const allRequestIds = [...new Set(allRequests.map((request) => request.id))];
        const directWorkshopIds = [
          ...new Set(
            directRequests
              .map((request) => request.target_workshop_id)
              .filter((id): id is string => Boolean(id)),
          ),
        ];

        const messagesStart = performance.now();
        const profilesStart = performance.now();
        if (allRequestIds.length > 0) {
          logPerf("query:messages_grouped:start", {
            requestIds: allRequestIds.length,
          });
        }
        if (directWorkshopIds.length > 0) {
          logPerf("query:profiles_grouped:start", {
            workshopIds: directWorkshopIds.length,
          });
        }
        const [messagesResult, profilesResult] = await Promise.all([
          allRequestIds.length > 0
            ? supabase
                .from("messages")
                .select(
                  "id, request_id, offer_id, sender_id, sender_role, message, images, created_at, read_at",
                )
                .in("request_id", allRequestIds)
                .order("created_at", { ascending: false })
            : Promise.resolve({ data: [], error: null }),
          directWorkshopIds.length > 0
            ? supabase
                .from("profiles")
                .select("id, workshop_name")
                .in("id", directWorkshopIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (allRequestIds.length > 0) {
          logPerf("query:messages_grouped:end", {
            durationMs: Number((performance.now() - messagesStart).toFixed(1)),
            count: messagesResult.data?.length || 0,
          });
        }
        if (directWorkshopIds.length > 0) {
          logPerf("query:profiles_grouped:end", {
            durationMs: Number((performance.now() - profilesStart).toFixed(1)),
            count: profilesResult.data?.length || 0,
          });
        }

        if (messagesResult.error) throw messagesResult.error;
        if (profilesResult.error) throw profilesResult.error;

        const messages = (messagesResult.data || []) as MessageRow[];
        const profiles = (profilesResult.data || []) as ProfileRow[];

        const profileMap = new Map(
          profiles.map((profile) => [profile.id, profile.workshop_name || "Service"]),
        );

        const relevantConversationKeys = new Set<string>([
          ...offers.map((offer) => getConversationKey(offer.request_id, offer.id)),
          ...directRequests.map((request) => getConversationKey(request.id, null)),
        ]);

        const messagesByConversation = new Map<string, MessageRow[]>();

        for (const message of messages) {
          const key = getConversationKey(message.request_id, message.offer_id ?? null);

          if (!relevantConversationKeys.has(key)) {
            continue;
          }

          const conversationMessages = messagesByConversation.get(key) || [];
          conversationMessages.push(message);
          messagesByConversation.set(key, conversationMessages);
        }

        const mappedOffers: Conversation[] = offers.flatMap((offer) => {
          const request = requestMap.get(offer.request_id);
          if (!request) return [];

          const conversationMessages =
            messagesByConversation.get(getConversationKey(offer.request_id, offer.id)) || [];

          const lastMessage = conversationMessages[0];
          const unreadCount = conversationMessages.filter((message) => {
            return (
              message.sender_id !== userId &&
              message.sender_role !== "system" &&
              message.read_at == null
            );
          }).length;

          const image =
            request.images?.[0]?.url || request.images?.[0]?.dataUrl || "";

          return [
            {
              requestId: request.id,
              offerId: offer.id,
              title: `${request.car_brand || "Lucrare"} ${request.car_model || ""}`,
              city: request.city || "-",
              status: request.status || "matched",
              image,
              workshopName: offer.workshop_name || "Service",
              lastMessage: getLastMessageText(lastMessage),
              lastMessageTime: lastMessage?.created_at || offer.created_at,
              unreadCount,
            },
          ];
        });

        const mappedDirectRequests: Conversation[] = directRequests.map((request) => {
          const conversationMessages =
            messagesByConversation.get(getConversationKey(request.id, null)) || [];
          const lastMessage = conversationMessages[0];
          const unreadCount = conversationMessages.filter((message) => {
            return (
              message.sender_id !== userId &&
              message.sender_role !== "system" &&
              message.read_at == null
            );
          }).length;

          return {
            requestId: request.id,
            offerId: null,
            title: "Mesaj direct Service",
            city: "Conversație directă",
            status: request.status || "open",
            image: "",
            workshopName: request.target_workshop_id
              ? profileMap.get(request.target_workshop_id) || "Service"
              : "Service",
            lastMessage: getLastMessageText(lastMessage),
            lastMessageTime: lastMessage?.created_at || request.created_at,
            unreadCount,
          };
        });

        const mapped = [...mappedOffers, ...mappedDirectRequests];

        mapped.sort(
          (a, b) =>
            new Date(b.lastMessageTime).getTime() -
            new Date(a.lastMessageTime).getTime(),
        );

        logPerf("setConversations:prepared", {
          totalConversations: mapped.length,
          firstConversationKey:
            mapped[0] != null
              ? getConversationKey(mapped[0].requestId, mapped[0].offerId)
              : null,
          firstUnreadCount: mapped[0]?.unreadCount ?? null,
          testConversationUnread: mapped.map((conversation) => ({
            key: getConversationKey(conversation.requestId, conversation.offerId),
            unreadCount: conversation.unreadCount,
          })),
        });
        setConversations(mapped);
        logPerf("loadConversations:end", {
          totalConversations: mapped.length,
        });
      } catch (error) {
        console.error("Failed to load conversations:", error);
        logPerf("loadConversations:error", {
          error: error instanceof Error ? error.message : String(error),
        });
        setConversations([]);
      } finally {
        if (showLoader) {
          setLoading(false);
        }
      }
    },
    [logPerf, role, router],
  );

  useEffect(() => {
    logPerf("mount");
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
          const newMessage = payload.new as MessageRow;
          logPerf("realtime:INSERT", {
            requestId: newMessage.request_id,
            offerId: newMessage.offer_id ?? null,
            readAt: newMessage.read_at,
            senderId: newMessage.sender_id,
            senderRole: newMessage.sender_role,
          });

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
              logPerf("realtime:INSERT:conversation_missing_refetch", {
                requestId: newMessage.request_id,
                offerId: newMessage.offer_id ?? null,
              });
              void loadConversations(false);
              return current;
            }

            const conversation = current[conversationIndex];

            const isIncomingMessage =
              newMessage.sender_id !== currentUserId &&
              newMessage.sender_role !== "system" &&
              newMessage.read_at == null;

            const updatedConversation: Conversation = {
              ...conversation,
              lastMessage: getLastMessageText(newMessage),
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
      logPerf("unmount");
      void supabase.removeChannel(channel);
    };
  }, [loadConversations, logPerf, role]);

  useEffect(() => {
    if (!loading) {
      logPerf("firstListVisible", {
        conversations: conversations.length,
      });
    }
  }, [conversations.length, loading, logPerf]);

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
