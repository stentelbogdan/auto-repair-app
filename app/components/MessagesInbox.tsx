"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
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

type ConversationInboxStateRow = {
  request_id: string;
  offer_id: string | null;
  hidden_at: string;
};

type PendingInboxMutation = {
  requestId: string;
  offerId: string | null;
  message: string;
  hasImages: boolean;
  createdAt: string;
  uiApplied?: boolean;
};

type PendingInboxMutationMap = Record<string, PendingInboxMutation>;

type PendingInboxMutationReference = {
  conversationKey: string;
  createdAt: string;
};

const PENDING_INBOX_MUTATIONS_STORAGE_KEY = "pending-inbox-mutations";
const SUPABASE_STORAGE_HOSTNAME = "ouoiykudvcoqbkybkqvs.supabase.co";

function isOptimizableInboxImage(src: string) {
  try {
    const url = new URL(src);

    return (
      url.protocol === "https:" &&
      url.hostname === SUPABASE_STORAGE_HOSTNAME &&
      url.pathname.startsWith("/storage/v1/object/public/")
    );
  } catch {
    return false;
  }
}

function getConversationKey(requestId: string, offerId: string | null) {
  return `${requestId}::${offerId ?? "direct"}`;
}

function isHiddenAtLastMessage(
  lastMessageCreatedAt: string | undefined,
  hiddenAt: string | undefined,
) {
  if (!hiddenAt) return false;
  if (!lastMessageCreatedAt) return true;

  return (
    new Date(lastMessageCreatedAt).getTime() <= new Date(hiddenAt).getTime()
  );
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

function readPendingInboxMutations(): PendingInboxMutationMap {
  try {
    const rawValue = sessionStorage.getItem(
      PENDING_INBOX_MUTATIONS_STORAGE_KEY,
    );

    if (!rawValue) {
      return {};
    }

    const parsedValue = JSON.parse(rawValue);

    if (!parsedValue || typeof parsedValue !== "object") {
      return {};
    }

    return parsedValue as PendingInboxMutationMap;
  } catch {
    return {};
  }
}

function writePendingInboxMutations(map: PendingInboxMutationMap) {
  if (Object.keys(map).length === 0) {
    sessionStorage.removeItem(PENDING_INBOX_MUTATIONS_STORAGE_KEY);
    return;
  }

  sessionStorage.setItem(
    PENDING_INBOX_MUTATIONS_STORAGE_KEY,
    JSON.stringify(map),
  );
}

function reconcilePendingInboxMutationStorage({
  uiAppliedMutations,
  dbConfirmedMutations,
}: {
  uiAppliedMutations: PendingInboxMutationReference[];
  dbConfirmedMutations: PendingInboxMutationReference[];
}) {
  if (uiAppliedMutations.length === 0 && dbConfirmedMutations.length === 0) {
    return;
  }

  const currentMutations = readPendingInboxMutations();
  let hasChanges = false;

  for (const { conversationKey, createdAt } of dbConfirmedMutations) {
    const currentMutation = currentMutations[conversationKey];

    if (currentMutation?.createdAt === createdAt) {
      delete currentMutations[conversationKey];
      hasChanges = true;
    }
  }

  for (const { conversationKey, createdAt } of uiAppliedMutations) {
    const currentMutation = currentMutations[conversationKey];

    if (
      currentMutation?.createdAt === createdAt &&
      currentMutation.uiApplied !== true
    ) {
      currentMutations[conversationKey] = {
        ...currentMutation,
        uiApplied: true,
      };
      hasChanges = true;
    }
  }

  if (hasChanges) {
    writePendingInboxMutations(currentMutations);
  }
}

function getPendingInboxMutationLastMessage(mutation: PendingInboxMutation) {
  const text = mutation.message.trim();

  if (text) {
    return text;
  }

  return mutation.hasImages ? "📷 Poză" : "Mesaj nou";
}

export default function MessagesInbox({ role }: { role: Role }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openConversationMenuKey, setOpenConversationMenuKey] = useState<
    string | null
  >(null);
  const [hidingConversationKey, setHidingConversationKey] = useState<
    string | null
  >(null);
  const [realtimeUserId, setRealtimeUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string>("");
  const perfStartRef = useRef<number>(performance.now());
  const loadConversationsGenerationRef = useRef(0);
  const loadConversationsSessionRef = useRef(0);
  const realtimeDegradedRef = useRef(false);
  const uiAppliedThisMountRef = useRef<Map<string, string>>(new Map());
  const realtimeInsertVersionRef = useRef(0);
  const lastRealtimeConversationKeyRef = useRef<string | null>(null);
  const inboxInstanceIdRef = useRef(
    `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );

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

  const invalidateLoadConversationsGeneration = useCallback(() => {
    loadConversationsGenerationRef.current += 1;
    return loadConversationsGenerationRef.current;
  }, []);

  const applyPendingInboxMutations = useCallback(
    (
      currentConversations: Conversation[],
      source: "ui" | "database",
    ) => {
      const pendingMutations = readPendingInboxMutations();
      const mutationEntries = Object.entries(pendingMutations);

      if (mutationEntries.length === 0) {
        return {
          nextConversations: currentConversations,
          uiAppliedMutations: [] as PendingInboxMutationReference[],
          dbConfirmedMutations: [] as PendingInboxMutationReference[],
        };
      }

      let hasChanges = false;
      const uiAppliedMutations: PendingInboxMutationReference[] = [];
      const dbConfirmedMutations: PendingInboxMutationReference[] = [];
      const nextConversations = currentConversations.map((conversation) => {
        const conversationKey = getConversationKey(
          conversation.requestId,
          conversation.offerId,
        );
        const mutation = pendingMutations[conversationKey];

        if (!mutation) {
          return conversation;
        }

        const mutationTime = new Date(mutation.createdAt).getTime();
        const conversationTime = new Date(conversation.lastMessageTime).getTime();
        const mutationReference = {
          conversationKey,
          createdAt: mutation.createdAt,
        };

        if (source === "database" && mutationTime <= conversationTime) {
          dbConfirmedMutations.push(mutationReference);
          return conversation;
        }

        const wasAppliedThisMount =
          uiAppliedThisMountRef.current.get(conversationKey) ===
          mutation.createdAt;

        if (mutation.uiApplied === true && !wasAppliedThisMount) {
          return conversation;
        }

        if (mutationTime <= conversationTime) {
          return conversation;
        }

        hasChanges = true;

        if (mutation.uiApplied !== true) {
          uiAppliedMutations.push(mutationReference);
        }

        return {
          ...conversation,
          lastMessage: getPendingInboxMutationLastMessage(mutation),
          lastMessageTime: mutation.createdAt,
        };
      });

      if (!hasChanges) {
        return {
          nextConversations: currentConversations,
          uiAppliedMutations,
          dbConfirmedMutations,
        };
      }

      nextConversations.sort(
        (a, b) =>
          new Date(b.lastMessageTime).getTime() -
          new Date(a.lastMessageTime).getTime(),
      );

      return {
        nextConversations,
        uiAppliedMutations,
        dbConfirmedMutations,
      };
    },
    [],
  );

  const loadConversations = useCallback(
    async (showLoader = true) => {
      const generation = invalidateLoadConversationsGeneration();
      const session = loadConversationsSessionRef.current;
      const realtimeVersionAtStart = realtimeInsertVersionRef.current;

      try {
        logPerf("loadConversations:start", {
          showLoader,
          generation,
          session,
          realtimeVersionAtStart,
        });

        if (showLoader) {
          setLoading(true);
        }

        const authStart = performance.now();
        logPerf("auth.getUser:start");
        const { data: authData } = await supabase.auth.getUser();
        logPerf("auth.getUser:end", {
          durationMs: Number((performance.now() - authStart).toFixed(1)),
          hasUser: Boolean(authData.user),
          generation,
        });

        if (
          loadConversationsSessionRef.current !== session ||
          loadConversationsGenerationRef.current !== generation
        ) {
          logPerf("loadConversations:staleIgnored", {
            generation,
            session,
            phase: "auth",
          });
          return;
        }

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const userId = authData.user.id;
        currentUserIdRef.current = userId;
        setRealtimeUserId((current) => (current === userId ? current : userId));

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
          generation,
        });
        logPerf("query:direct_requests:end", {
          durationMs: Number(
            (performance.now() - directRequestsStart).toFixed(1),
          ),
          count: directRequestsData?.length || 0,
          generation,
        });

        if (
          loadConversationsSessionRef.current !== session ||
          loadConversationsGenerationRef.current !== generation
        ) {
          logPerf("loadConversations:staleIgnored", {
            generation,
            session,
            phase: "offers-direct-requests",
          });
          return;
        }

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
            generation,
          });

          if (
            loadConversationsSessionRef.current !== session ||
            loadConversationsGenerationRef.current !== generation
          ) {
            logPerf("loadConversations:staleIgnored", {
              generation,
              session,
              phase: "requests-for-offers",
            });
            return;
          }

          if (requestsError) throw requestsError;
          requests = (requestsData || []) as RequestRow[];
        }

        const allRequests = [...requests, ...directRequests];
        const requestMap = new Map(allRequests.map((request) => [request.id, request]));

        const allRequestIds = [
          ...new Set([
            ...requests.map((request) => request.id),
            ...offerRequestIds,
            ...directRequests.map((request) => request.id),
          ]),
        ];
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
        const [messagesResult, profilesResult, inboxStatesResult] =
          await Promise.all([
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
          supabase
            .from("conversation_inbox_states")
            .select("request_id, offer_id, hidden_at")
            .eq("user_id", userId),
        ]);
        if (allRequestIds.length > 0) {
          logPerf("query:messages_grouped:end", {
            durationMs: Number((performance.now() - messagesStart).toFixed(1)),
            count: messagesResult.data?.length || 0,
            generation,
          });
        }
        if (directWorkshopIds.length > 0) {
          logPerf("query:profiles_grouped:end", {
            durationMs: Number((performance.now() - profilesStart).toFixed(1)),
            count: profilesResult.data?.length || 0,
            generation,
          });
        }

        if (
          loadConversationsSessionRef.current !== session ||
          loadConversationsGenerationRef.current !== generation
        ) {
          logPerf("loadConversations:staleIgnored", {
            generation,
            session,
            phase: "messages-profiles",
          });
          return;
        }

        if (messagesResult.error) throw messagesResult.error;
        if (profilesResult.error) throw profilesResult.error;
        if (inboxStatesResult.error) throw inboxStatesResult.error;

        const messages = (messagesResult.data || []) as MessageRow[];
        const profiles = (profilesResult.data || []) as ProfileRow[];
        const inboxStates = (inboxStatesResult.data ||
          []) as ConversationInboxStateRow[];

        const profileMap = new Map(
          profiles.map((profile) => [profile.id, profile.workshop_name || "Service"]),
        );
        const hiddenAtByConversation = new Map(
          inboxStates.map((state) => [
            getConversationKey(state.request_id, state.offer_id ?? null),
            state.hidden_at,
          ]),
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
          const conversationMessages =
            messagesByConversation.get(
              getConversationKey(offer.request_id, offer.id),
            ) || [];

          const lastMessage = conversationMessages.find(
            (message) => message.sender_role !== "system",
          );

          if (!lastMessage) {
            return [];
          }

          const conversationKey = getConversationKey(
            offer.request_id,
            offer.id,
          );

          if (
            isHiddenAtLastMessage(
              lastMessage?.created_at,
              hiddenAtByConversation.get(conversationKey),
            )
          ) {
            return [];
          }

          const unreadCount = conversationMessages.filter((message) => {
            return (
              message.sender_id !== userId &&
              message.sender_role !== "system" &&
              message.read_at == null
            );
          }).length;

          const image =
            request?.images?.[0]?.url || request?.images?.[0]?.dataUrl || "";

          return [
            {
              requestId: offer.request_id,
              offerId: offer.id,
              title: request
                ? `${request.car_brand || "Lucrare"} ${request.car_model || ""}`
                : "Conversație ofertă",
              city: request?.city || "-",
              status: request?.status || offer.status || "pending",
              image,
              workshopName: offer.workshop_name || "Service",
              lastMessage: getLastMessageText(lastMessage),
              lastMessageTime: lastMessage.created_at,
              unreadCount,
            },
          ];
        });

        const mappedDirectRequests: Conversation[] = directRequests.flatMap(
          (request) => {
            const conversationMessages =
              messagesByConversation.get(
                getConversationKey(request.id, null),
              ) || [];
            const lastMessage = conversationMessages.find(
              (message) => message.sender_role !== "system",
            );

            if (!lastMessage) {
              return [];
            }

            const conversationKey = getConversationKey(request.id, null);

            if (
              isHiddenAtLastMessage(
                lastMessage.created_at,
                hiddenAtByConversation.get(conversationKey),
              )
            ) {
              return [];
            }

            const unreadCount = conversationMessages.filter((message) => {
              return (
                message.sender_id !== userId &&
                message.sender_role !== "system" &&
                message.read_at == null
              );
            }).length;

            return [
              {
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
                lastMessageTime: lastMessage.created_at,
                unreadCount,
              },
            ];
          },
        );

        const mapped = [...mappedOffers, ...mappedDirectRequests];

        mapped.sort(
          (a, b) =>
            new Date(b.lastMessageTime).getTime() -
            new Date(a.lastMessageTime).getTime(),
        );

        logPerf("setConversations:prepared", {
          totalConversations: mapped.length,
          generation,
          firstConversationKey:
            mapped[0] != null
              ? getConversationKey(mapped[0].requestId, mapped[0].offerId)
              : null,
          firstUnreadCount: mapped[0]?.unreadCount ?? null,
          testConversationUnread: mapped.map((conversation) => ({
            key: getConversationKey(conversation.requestId, conversation.offerId),
            unreadCount: conversation.unreadCount,
          })),
          incomingRelevantReadStates: mapped.map((conversation) => {
            const conversationMessages =
              messagesByConversation.get(
                getConversationKey(
                  conversation.requestId,
                  conversation.offerId ?? null,
                ),
              ) || [];

            return {
              key: getConversationKey(
                conversation.requestId,
                conversation.offerId ?? null,
              ),
              incomingMessages: conversationMessages
                .filter(
                  (message) =>
                    message.sender_id !== userId &&
                    message.sender_role !== "system",
                )
                .map((message) => ({
                  id: message.id,
                  createdAt: message.created_at,
                  readAt: message.read_at,
                })),
            };
          }),
        });

        if (
          loadConversationsSessionRef.current !== session ||
          loadConversationsGenerationRef.current !== generation
        ) {
          logPerf("loadConversations:staleIgnored", {
            generation,
            session,
            phase: "before-setConversations",
          });
          return;
        }

        const {
          nextConversations,
          uiAppliedMutations,
          dbConfirmedMutations,
        } = applyPendingInboxMutations(mapped, "database");

        for (const { conversationKey, createdAt } of uiAppliedMutations) {
          uiAppliedThisMountRef.current.set(conversationKey, createdAt);
        }

        for (const { conversationKey, createdAt } of dbConfirmedMutations) {
          if (
            uiAppliedThisMountRef.current.get(conversationKey) === createdAt
          ) {
            uiAppliedThisMountRef.current.delete(conversationKey);
          }
        }

        reconcilePendingInboxMutationStorage({
          uiAppliedMutations,
          dbConfirmedMutations,
        });

        const trackedConversationKey = lastRealtimeConversationKeyRef.current;
        const trackedConversation = trackedConversationKey
          ? nextConversations.find(
              (conversation) =>
                getConversationKey(
                  conversation.requestId,
                  conversation.offerId,
                ) === trackedConversationKey,
            )
          : null;

        logPerf("loadConversations:beforeSetConversations", {
          generation,
          realtimeVersionAtStart,
          realtimeVersionBeforeSet: realtimeInsertVersionRef.current,
          startedBeforeLatestRealtimeInsert:
            realtimeVersionAtStart < realtimeInsertVersionRef.current,
          trackedConversationKey,
          trackedConversation: trackedConversation
            ? {
                lastMessage: trackedConversation.lastMessage,
                lastMessageTime: trackedConversation.lastMessageTime,
                unreadCount: trackedConversation.unreadCount,
              }
            : null,
        });

        setConversations(nextConversations);
        logPerf("loadConversations:end", {
          totalConversations: nextConversations.length,
          generation,
        });
      } catch (error) {
        console.error("Failed to load conversations:", error);
        logPerf("loadConversations:error", {
          generation,
          error: error instanceof Error ? error.message : String(error),
        });

        if (
          loadConversationsSessionRef.current === session &&
          loadConversationsGenerationRef.current === generation
        ) {
          setConversations([]);
        }
      } finally {
        if (
          showLoader &&
          loadConversationsSessionRef.current === session &&
          loadConversationsGenerationRef.current === generation
        ) {
          setLoading(false);
        }
      }
    },
    [
      applyPendingInboxMutations,
      invalidateLoadConversationsGeneration,
      logPerf,
      role,
      router,
    ],
  );

  const hideConversation = async (conversation: Conversation) => {
    const confirmed = window.confirm(
      "Conversația va fi eliminată din Inbox-ul tău. Va reapărea dacă este trimis un mesaj nou.",
    );

    if (!confirmed) return;

    const conversationKey = getConversationKey(
      conversation.requestId,
      conversation.offerId,
    );

    setOpenConversationMenuKey(null);
    setHidingConversationKey(conversationKey);
    invalidateLoadConversationsGeneration();
    setConversations((current) =>
      current.filter(
        (item) =>
          getConversationKey(item.requestId, item.offerId) !== conversationKey,
      ),
    );

    const { error } = await supabase.rpc("hide_conversation_from_inbox", {
      p_request_id: conversation.requestId,
      p_offer_id: conversation.offerId,
    });

    if (error) {
      window.alert("Conversația nu a putut fi eliminată din Inbox.");
    } else {
      window.dispatchEvent(new Event("conversation-inbox-state-updated"));
    }

    setHidingConversationKey(null);
    await loadConversations(false);
  };

  useEffect(() => {
    const instanceId = inboxInstanceIdRef.current;
    const channelName = `messages-inbox-${role}`;
    loadConversationsSessionRef.current += 1;
    realtimeDegradedRef.current = false;
    logPerf("mount", { instanceId });
    localStorage.setItem("activeRole", role);

    void loadConversations();

    const channelsBeforeCreate = supabase.getChannels();
    const existingChannel = channelsBeforeCreate.find(
      (existing) => existing.topic === `realtime:${channelName}`,
    );

    logPerf("channel:create", {
      instanceId,
      channelName,
      timestamp: new Date().toISOString(),
      existingChannelFound: Boolean(existingChannel),
      existingChannelState: existingChannel?.state ?? null,
      activeChannelTopics: channelsBeforeCreate.map((existing) => ({
        topic: existing.topic,
        state: existing.state,
      })),
    });

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
        },
        (payload) => {
          const newMessage = payload.new as MessageRow;
          const conversationKey = getConversationKey(
            newMessage.request_id,
            newMessage.offer_id ?? null,
          );
          const currentUserId = currentUserIdRef.current;
          const isIncomingMessage =
            newMessage.sender_id !== currentUserId &&
            newMessage.sender_role !== "system" &&
            newMessage.read_at == null;
          const realtimeVersion = realtimeInsertVersionRef.current + 1;
          realtimeInsertVersionRef.current = realtimeVersion;
          lastRealtimeConversationKeyRef.current = conversationKey;

          logPerf("realtime:INSERT", {
            instanceId,
            channelName,
            channelState: channel.state,
            realtimeVersion,
            conversationKey,
            requestId: newMessage.request_id,
            offerId: newMessage.offer_id ?? null,
            readAt: newMessage.read_at,
            currentUserId,
            senderId: newMessage.sender_id,
            senderRole: newMessage.sender_role,
            isIncomingMessage,
            nextLastMessage: getLastMessageText(newMessage),
            nextLastMessageTime: newMessage.created_at,
          });

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
                realtimeVersion,
                conversationKey,
                requestId: newMessage.request_id,
                offerId: newMessage.offer_id ?? null,
                currentUserId,
                senderId: newMessage.sender_id,
                isIncomingMessage,
              });
              void loadConversations(false);
              return current;
            }

            const conversation = current[conversationIndex];

            const updatedConversation: Conversation = {
              ...conversation,
              lastMessage: getLastMessageText(newMessage),
              lastMessageTime: newMessage.created_at,
              unreadCount:
                conversation.unreadCount + (isIncomingMessage ? 1 : 0),
            };

            logPerf("realtime:INSERT:applyConversationUpdate", {
              realtimeVersion,
              conversationKey,
              conversationIndex,
              currentUserId,
              senderId: newMessage.sender_id,
              isIncomingMessage,
              before: {
                lastMessage: conversation.lastMessage,
                lastMessageTime: conversation.lastMessageTime,
                unreadCount: conversation.unreadCount,
              },
              after: {
                lastMessage: updatedConversation.lastMessage,
                lastMessageTime: updatedConversation.lastMessageTime,
                unreadCount: updatedConversation.unreadCount,
              },
            });

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
      .subscribe((status) => {
        logPerf("channel:status", {
          instanceId,
          channelName,
          channelState: channel.state,
          status,
          timestamp: new Date().toISOString(),
          reusedExistingChannel: channel === existingChannel,
        });

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          realtimeDegradedRef.current = true;
          return;
        }

        if (status === "SUBSCRIBED" && realtimeDegradedRef.current) {
          realtimeDegradedRef.current = false;
          logPerf("channel:reconcileAfterDegraded");
          void loadConversations(false);
        }
      });

    return () => {
      const invalidatedGeneration = invalidateLoadConversationsGeneration();
      loadConversationsSessionRef.current += 1;
      realtimeDegradedRef.current = false;
      logPerf("channel:cleanup:start", {
        instanceId,
        channelName,
        channelState: channel.state,
        timestamp: new Date().toISOString(),
        invalidatedGeneration,
      });
      void supabase.removeChannel(channel).then((result) => {
        logPerf("channel:cleanup:end", {
          instanceId,
          channelName,
          channelState: channel.state,
          timestamp: new Date().toISOString(),
          result,
        });
      });
    };
  }, [invalidateLoadConversationsGeneration, loadConversations, logPerf, role]);

  useEffect(() => {
    if (!realtimeUserId) return;

    const instanceId = inboxInstanceIdRef.current;
    const channelName = `conversation-inbox-states-${realtimeUserId}-${instanceId}`;
    let active = true;
    let refreshInFlight = false;
    let pendingRefresh = false;
    let realtimeDegraded = false;

    const runReconciliation = async () => {
      refreshInFlight = true;

      do {
        pendingRefresh = false;
        await loadConversations(false);
      } while (active && pendingRefresh);

      refreshInFlight = false;
    };

    const scheduleReconciliation = (reason: string) => {
      if (!active) return;

      logPerf("inboxStateRealtime:scheduleReconciliation", {
        channelName,
        reason,
        refreshInFlight,
        pendingRefresh,
      });

      if (refreshInFlight) {
        pendingRefresh = true;
        return;
      }

      void runReconciliation();
    };

    const handleInboxStateChange = (payload: {
      eventType: "INSERT" | "UPDATE";
    }) => {
      logPerf("inboxStateRealtime:change", {
        channelName,
        eventType: payload.eventType,
      });
      scheduleReconciliation(
        `realtime:conversation-inbox-state:${payload.eventType}`,
      );
    };

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_inbox_states",
          filter: `user_id=eq.${realtimeUserId}`,
        },
        (payload) => {
          handleInboxStateChange(payload);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_inbox_states",
          filter: `user_id=eq.${realtimeUserId}`,
        },
        (payload) => {
          handleInboxStateChange(payload);
        },
      )
      .subscribe((status, error) => {
        if (!active) return;

        logPerf("inboxStateRealtime:status", {
          channelName,
          status,
        });

        if (process.env.NODE_ENV === "development" && error) {
          console.error("[MSG-PERF][Inbox] Realtime subscription error", {
            status,
            name: error.name,
            message: error.message,
          });
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          realtimeDegraded = true;
          return;
        }

        if (status === "SUBSCRIBED" && realtimeDegraded) {
          realtimeDegraded = false;
          scheduleReconciliation("realtime:conversation-inbox-state:recovered");
        }
      });

    return () => {
      active = false;
      pendingRefresh = false;
      realtimeDegraded = false;
      logPerf("inboxStateRealtime:cleanup", { channelName });
      void supabase.removeChannel(channel);
    };
  }, [loadConversations, logPerf, realtimeUserId]);

  useLayoutEffect(() => {
    if (conversations.length === 0) {
      return;
    }

    const {
      nextConversations,
      uiAppliedMutations,
      dbConfirmedMutations,
    } = applyPendingInboxMutations(conversations, "ui");

    for (const { conversationKey, createdAt } of uiAppliedMutations) {
      uiAppliedThisMountRef.current.set(conversationKey, createdAt);
    }

    reconcilePendingInboxMutationStorage({
      uiAppliedMutations,
      dbConfirmedMutations,
    });

    if (nextConversations !== conversations) {
      logPerf("pendingInboxMutations:appliedOnMountedState", {
        appliedKeys: uiAppliedMutations.map(
          ({ conversationKey }) => conversationKey,
        ),
      });
      setConversations(nextConversations);
    }
  }, [applyPendingInboxMutations, conversations, logPerf]);

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
            {conversations.map((conversation, index) => {
              const conversationKey = getConversationKey(
                conversation.requestId,
                conversation.offerId,
              );
              const isMenuOpen = openConversationMenuKey === conversationKey;
              const isHiding = hidingConversationKey === conversationKey;
              const isAboveFoldThumbnail = index < 3;

              return (
                <div
                  key={conversationKey}
                  className="relative flex w-full items-center rounded-[26px] border border-white/10 bg-white/[0.04] transition hover:bg-white/[0.07]"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenConversationMenuKey(null);
                      localStorage.setItem("activeRole", role);

                      router.push(
                        conversation.offerId
                          ? `/chat/${conversation.requestId}?offerId=${conversation.offerId}&role=${role}`
                          : `/chat/${conversation.requestId}?role=${role}`,
                      );
                    }}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-l-[26px] p-4 pr-2 text-left transition active:scale-[0.99]"
                  >
                    <div className="relative h-16 w-16 shrink-0 overflow-visible">
                  <div className="h-16 w-16 overflow-hidden rounded-2xl bg-white/10">
                    {conversation.image ? (
                      <Image
                        src={conversation.image}
                        alt={conversation.title}
                        width={64}
                        height={64}
                        sizes="64px"
                        loading={isAboveFoldThumbnail ? "eager" : "lazy"}
                        unoptimized={
                          !isOptimizableInboxImage(conversation.image)
                        }
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

                  <button
                    type="button"
                    aria-label="Opțiuni conversație"
                    aria-expanded={isMenuOpen}
                    disabled={isHiding}
                    onClick={() =>
                      setOpenConversationMenuKey((current) =>
                        current === conversationKey ? null : conversationKey,
                      )
                    }
                    className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl font-black text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-40"
                  >
                    ⋯
                  </button>

                  {isMenuOpen && (
                    <div className="absolute right-3 top-[calc(100%-0.5rem)] z-20 min-w-52 rounded-2xl border border-white/10 bg-neutral-900 p-2 shadow-2xl shadow-black/50">
                      <button
                        type="button"
                        disabled={isHiding}
                        onClick={() => void hideConversation(conversation)}
                        className="w-full rounded-xl px-4 py-3 text-left text-sm font-bold text-red-300 transition hover:bg-red-500/10 disabled:opacity-40"
                      >
                        Șterge conversația
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
