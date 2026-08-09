"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import imageCompression from "browser-image-compression";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

type ChatImage = {
  url: string;
  path?: string;
  name?: string;
};

type Message = {
  id: string;
  request_id: string;
  offer_id?: string | null;
  sender_id: string;
  sender_role: string;
  message: string;
  images?: ChatImage[] | null;
  created_at: string;
  delivered_at?: string | null;
  read_at?: string | null;
};

type RepairImage = {
  name?: string;
  url?: string;
  dataUrl?: string;
};

type RequestData = {
  car_brand: string | null;
  car_model: string | null;
  city: string | null;
  status: string | null;
  images: RepairImage[] | null;
  request_type: string | null;
  target_workshop_id: string | null;
};

const quickMessages = [
  "Când pot aduce mașina?",
  "Cât durează lucrarea?",
  "Mașina este gata?",
  "Poți să îmi trimiți poze cu progresul?",
];

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params.requestId as string;
  const searchParams = useSearchParams();
  const offerId = searchParams.get("offerId");
  const roleParam = searchParams.get("role");

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [newMessage, setNewMessage] = useState("");
  const [userId, setUserId] = useState("");
  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [sendingQuickMessage, setSendingQuickMessage] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [activeRole, setActiveRole] = useState<string>("customer");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [isSending, setIsSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const systemMessageCreatedRef = useRef(false);

  const [selectedChatGallery, setSelectedChatGallery] = useState<{
    images: ChatImage[];
    index: number;
  } | null>(null);

  const [workshopProfile, setWorkshopProfile] = useState<{
    workshop_name: string | null;
    workshop_slug: string | null;
  } | null>(null);

  const belongsToCurrentConversation = useCallback(
    (messageOfferId?: string | null) => {
      return offerId ? messageOfferId === offerId : messageOfferId == null;
    },
    [offerId],
  );

  const loadMessages = useCallback(async () => {
    if (!requestId) return;

    let query = supabase
      .from("messages")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (offerId) {
      query = query.eq("offer_id", offerId);
    } else {
      query = query.is("offer_id", null);
    }

    const { data, error } = await query;

    if (error) {
      setMessagesLoading(false);
      return;
    }

    if (data && data.length > 0) {
      setMessages(data);
      setMessagesLoading(false);
      return;
    }

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) return;

    if (systemMessageCreatedRef.current) return;
    systemMessageCreatedRef.current = true;

    await supabase.from("messages").insert({
      request_id: requestId,
      offer_id: offerId,
      sender_id: authData.user.id,
      sender_role: "system",
      message: "Conversația a fost începută din profilul service-ului.",
      images: [],
    });

    setMessagesLoading(false);
  }, [offerId, requestId]);

  const markConversationAsRead = useCallback(async () => {
    if (!userId || !requestId || messages.length === 0) return;

    const now = new Date().toISOString();
    const unreadMessageIds = messages
      .filter(
        (message) =>
          message.request_id === requestId &&
          belongsToCurrentConversation(message.offer_id) &&
          message.sender_id !== userId &&
          message.sender_role !== "system" &&
          !message.read_at,
      )
      .map((message) => message.id);

    if (unreadMessageIds.length === 0) return;

    await supabase
      .from("messages")
      .update({ read_at: now })
      .in("id", unreadMessageIds);

    sessionStorage.setItem(
      "last-read-conversation",
      JSON.stringify({
        requestId,
        offerId: offerId ?? null,
        readAt: Date.now(),
      }),
    );

    window.dispatchEvent(new Event("messages-read-updated"));
  }, [belongsToCurrentConversation, messages, offerId, requestId, userId]);

  useEffect(() => {
    const syncMessages = () => {
      void loadMessages();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncMessages();
      }
    };

    window.addEventListener("focus", syncMessages);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", syncMessages);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadMessages]);

  useEffect(() => {
    const container = messagesContainerRef.current;

    if (!container) return;

    const timeout = setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "auto",
      });
    }, 100);

    return () => clearTimeout(timeout);
  }, [messages, isOtherTyping]);

  useEffect(() => {
    void markConversationAsRead();
  }, [markConversationAsRead]);

  useEffect(() => {
    const previews = selectedImages.map((file) => URL.createObjectURL(file));
    setImagePreviews(previews);

    return () => {
      previews.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedImages]);

  const getUser = async () => {
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      setUserId(data.user.id);
    }
  };

  const loadRequest = useCallback(async () => {
    const { data, error } = await supabase
      .from("repair_requests")
      .select(
        `
  car_brand,
  car_model,
  city,
  status,
  images,
  request_type,
  target_workshop_id
`,
      )
      .eq("id", requestId)
      .single<RequestData>();

    if (!error && data) {
      setRequestData(data);
    }
  }, [requestId]);

  const loadWorkshopProfile = useCallback(async () => {
    const { data: request } = await supabase
      .from("repair_requests")
      .select("target_workshop_id")
      .eq("id", requestId)
      .single();

    if (request?.target_workshop_id) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("workshop_name, workshop_slug")
        .eq("id", request.target_workshop_id)
        .single();

      setWorkshopProfile({
        workshop_name: profileData?.workshop_name || "Service",
        workshop_slug: profileData?.workshop_slug || null,
      });

      return;
    }

    let offerQuery = supabase
      .from("repair_offers")
      .select("workshop_user_id, workshop_name")
      .eq("request_id", requestId);

    if (offerId) {
      offerQuery = offerQuery.eq("id", offerId);
    } else {
      offerQuery = offerQuery.eq("status", "accepted");
    }

    const { data: offerData } = await offerQuery.maybeSingle();

    if (!offerData?.workshop_user_id) return;

    const { data: profileData } = await supabase
      .from("profiles")
      .select("workshop_name, workshop_slug")
      .eq("id", offerData.workshop_user_id)
      .single();

    setWorkshopProfile({
      workshop_name:
        profileData?.workshop_name || offerData.workshop_name || "Service",
      workshop_slug: profileData?.workshop_slug || null,
    });
  }, [offerId, requestId]);

  useEffect(() => {
    const savedRole = localStorage.getItem("activeRole");

    if (roleParam === "workshop") {
      localStorage.setItem("activeRole", "workshop");
      setActiveRole("workshop");
    } else if (roleParam === "customer") {
      localStorage.setItem("activeRole", "customer");
      setActiveRole("customer");
    } else if (savedRole) {
      setActiveRole(savedRole);
    }

    void loadMessages();
    void getUser();
    void loadRequest();
    void loadWorkshopProfile();

    const channel = supabase
      .channel(`chat-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          const insertedMessage = payload.new as Message;

          if (!belongsToCurrentConversation(insertedMessage.offer_id)) {
            return;
          }

          setMessages((prev) => {
            if (prev.some((message) => message.id === insertedMessage.id)) {
              return prev;
            }

            return [...prev, insertedMessage].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime(),
            );
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          const updatedMessage = payload.new as Message;

          if (!belongsToCurrentConversation(updatedMessage.offer_id)) {
            return;
          }

          setMessages((prev) =>
            prev.map((message) =>
              message.id === updatedMessage.id ? updatedMessage : message,
            ),
          );
        },
      )
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.senderId === userId) return;

        setIsOtherTyping(Boolean(payload.payload?.isTyping));

        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }

        typingTimeoutRef.current = setTimeout(() => {
          setIsOtherTyping(false);
        }, 1800);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

      void supabase.removeChannel(channel);
    };
  }, [
    belongsToCurrentConversation,
    loadMessages,
    loadRequest,
    loadWorkshopProfile,
    requestId,
    roleParam,
    userId,
  ]);

  const sendTypingStatus = async (isTyping: boolean) => {
    if (!channelRef.current || !userId) return;

    await channelRef.current.send({
      type: "broadcast",
      event: "typing",
      payload: {
        senderId: userId,
        role: activeRole,
        isTyping,
      },
    });
  };

  const uploadSelectedImages = async (senderId: string) => {
    const uploadedImages: ChatImage[] = [];

    for (const file of selectedImages) {
      const compressedFile = await imageCompression(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
      });

      const fileName = `${crypto.randomUUID()}.jpg`;
      const filePath = `${requestId}/${senderId}/${fileName}`;

      const { error } = await supabase.storage
        .from("chat-images")
        .upload(filePath, compressedFile, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        });

      if (error) {
        throw error;
      }

      const { data } = supabase.storage
        .from("chat-images")
        .getPublicUrl(filePath);

      uploadedImages.push({
        url: data.publicUrl,
        path: filePath,
        name: file.name,
      });
    }

    return uploadedImages;
  };

  const insertMessage = async (text: string, images: ChatImage[] = []) => {
    const cleanText = text.trim();

    if (!cleanText && images.length === 0) return;

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) return;

    const { error } = await supabase.from("messages").insert({
      request_id: requestId,
      offer_id: offerId,
      sender_id: authData.user.id,
      sender_role: "user",
      message: cleanText,
      images,
    });
    if (!error) {
      sendTypingStatus(false);
    }
  };

  const sendMessage = async () => {
    const text = newMessage.trim();

    if (!text && selectedImages.length === 0) return;

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      alert("Nu ești logat.");
      return;
    }

    try {
      setIsSending(true);

      const uploadedImages = await uploadSelectedImages(authData.user.id);

      const { error } = await supabase.from("messages").insert({
        request_id: requestId,
        offer_id: offerId,
        sender_id: authData.user.id,
        sender_role: "user",
        message: text,
        images: uploadedImages,
      });

      if (error) {
        console.error("Failed to send message:", error);
        alert("Mesajul nu a putut fi trimis.");
        return;
      }

      setNewMessage("");
      setSelectedImages([]);
      sendTypingStatus(false);
    } catch (error: unknown) {
      console.error("Failed to upload/send message:", error);

      const errorMessage =
        error instanceof Error
          ? error.message
          : "Pozele sau mesajul nu au putut fi trimise.";

      alert(errorMessage);
    } finally {
      setIsSending(false);
    }
  };

  const sendQuickMessage = async (text: string) => {
    try {
      setSendingQuickMessage(true);
      await insertMessage(text);
    } finally {
      setSendingQuickMessage(false);
    }
  };

  const handleInputChange = (value: string) => {
    setNewMessage(value);
    sendTypingStatus(value.trim().length > 0);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false);
    }, 1200);
  };

  const handleImageSelect = (files: FileList | null) => {
    if (!files) return;

    const imageFiles = Array.from(files).filter((file) =>
      file.type.startsWith("image/"),
    );

    setSelectedImages((prev) => [...prev, ...imageFiles].slice(0, 8));

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeSelectedImage = (index: number) => {
    setSelectedImages((prev) => prev.filter((_, i) => i !== index));
  };

  const firstImage =
    requestData?.images?.[0]?.url || requestData?.images?.[0]?.dataUrl || "";

  const lastOwnMessageId = [...messages]
    .reverse()
    .find(
      (message) =>
        message.sender_id === userId && message.sender_role !== "system",
    )?.id;

  const getAllChatImages = () => {
    return messages.flatMap((message) => message.images || []);
  };

  return (
    <main className="flex h-[calc(100svh-245px)] flex-col bg-black text-white md:h-[calc(100vh-150px)]">
      <div className="border-b border-white/10 bg-black/80 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          {firstImage ? (
            <img
              src={firstImage}
              alt="Mașină"
              className="h-14 w-14 rounded-2xl object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-sm font-bold text-white/60">
              AR
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-white">
              {requestData?.car_brand || "Lucrare"}{" "}
              {requestData?.car_model || ""}
            </h1>

            {workshopProfile?.workshop_slug ? (
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/workshops/profile/${workshopProfile.workshop_slug}`,
                  )
                }
                className="mt-0.5 block truncate text-left text-sm font-semibold text-orange-300 underline decoration-orange-400/50 underline-offset-4"
              >
                {workshopProfile.workshop_name || "Service"}
              </button>
            ) : (
              <p className="text-sm text-white/50">
                {requestData?.car_brand === "Mesaj direct"
                  ? "Conversație directă"
                  : `${requestData?.city || "-"} • ${formatStatus(requestData?.status)}`}
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 pb-12 md:pb-32"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messagesLoading ? (
            <div className="mx-auto mt-10 rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-white/45">
              Se încarcă conversația...
            </div>
          ) : (
            <>
              {messages.map((message) => {
                const isSystem = message.sender_role === "system";
                const isMine = message.sender_id === userId && !isSystem;
                const isLastOwnMessage = message.id === lastOwnMessageId;
                const images = message.images || [];

                if (isSystem) {
                  return (
                    <div
                      key={message.id}
                      className="mx-auto max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-center text-sm leading-6 text-white/55"
                    >
                      {message.message}
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={`animate-[messageIn_0.25s_ease] max-w-[80%] ${
                      isMine ? "ml-auto" : ""
                    }`}
                  >
                    <div
                      className={`overflow-hidden rounded-3xl ${
                        images.length > 0 && !message.message
                          ? "bg-transparent"
                          : isMine
                            ? "bg-white text-black"
                            : "bg-white/10 text-white"
                      }`}
                    >
                      {images.length > 0 && (
                        <div
                          className={`grid gap-1 p-1 ${
                            images.length === 1 ? "grid-cols-1" : "grid-cols-2"
                          } ${isMine ? "justify-items-end" : "justify-items-start"}`}
                        >
                          {images.map((image, index) => (
                            <button
                              key={`${image.url}-${index}`}
                              type="button"
                              onClick={() => {
                                const allImages = getAllChatImages();
                                const imageIndex = allImages.findIndex(
                                  (item) => item.url === image.url,
                                );

                                setSelectedChatGallery({
                                  images: allImages,
                                  index: imageIndex >= 0 ? imageIndex : 0,
                                });
                              }}
                              className="block overflow-hidden rounded-2xl bg-black/20"
                            >
                              <img
                                src={image.url}
                                alt={image.name || "Poză chat"}
                                className="h-40 w-64 max-w-full object-cover"
                              />
                            </button>
                          ))}
                        </div>
                      )}

                      {message.message && (
                        <div className="px-4 py-3 text-sm leading-6">
                          {message.message}
                        </div>
                      )}
                    </div>

                    <p
                      className={`mt-1 px-2 text-[11px] text-white/35 ${
                        isMine ? "text-right" : "text-left"
                      }`}
                    >
                      {formatTime(message.created_at)}
                      {isMine && isLastOwnMessage && (
                        <span> · {message.read_at ? "Văzut" : "Livrat"}</span>
                      )}
                    </p>
                  </div>
                );
              })}

              {isOtherTyping && (
                <div className="animate-[messageIn_0.25s_ease] max-w-[80%] rounded-3xl bg-white/10 px-4 py-3 text-sm text-white/60">
                  {activeRole === "workshop" ? "Clientul" : "Service-ul"}{" "}
                  scrie...
                </div>
              )}

              <div ref={bottomRef} />
            </>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quickMessages.map((text) => (
              <button
                key={text}
                type="button"
                disabled={sendingQuickMessage || isSending}
                onClick={() => sendQuickMessage(text)}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/80 transition active:scale-[0.98] disabled:opacity-50"
              >
                {text}
              </button>
            ))}
          </div>

          {imagePreviews.length > 0 && (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {imagePreviews.map((preview, index) => (
                <div
                  key={preview}
                  className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-white/10"
                >
                  <img
                    src={preview}
                    alt="Preview"
                    className="h-full w-full object-cover"
                  />

                  <button
                    type="button"
                    onClick={() => removeSelectedImage(index)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-xs font-bold text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageSelect(e.target.files)}
          />

          <div className="flex gap-3">
            <button
              type="button"
              disabled={isSending}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-2xl text-white active:scale-[0.98] disabled:opacity-50"
              aria-label="Adaugă poze"
            >
              +
            </button>

            <input
              value={newMessage}
              disabled={isSending}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Scrie un mesaj..."
              className="h-14 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 text-white outline-none placeholder:text-white/35 disabled:opacity-60"
            />

            <button
              type="button"
              disabled={
                isSending || (!newMessage.trim() && selectedImages.length === 0)
              }
              onClick={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="rounded-2xl bg-white px-5 py-3 font-semibold text-black active:scale-[0.98] disabled:opacity-50"
            >
              {isSending ? "..." : "Trimite"}
            </button>
          </div>
        </div>
      </div>

      <Lightbox
        open={!!selectedChatGallery}
        close={() => setSelectedChatGallery(null)}
        index={selectedChatGallery?.index || 0}
        slides={
          selectedChatGallery?.images.map((image) => ({
            src: image.url,
          })) || []
        }
        plugins={[Zoom]}
        controller={{
          closeOnBackdropClick: true,
          closeOnPullDown: true,
        }}
        animation={{
          fade: 220,
          swipe: 260,
          zoom: 260,
        }}
        zoom={{
          maxZoomPixelRatio: 4,
          scrollToZoom: true,
          doubleTapDelay: 250,
          doubleClickDelay: 250,
        }}
        carousel={{
          finite: true,
          padding: "16px",
          spacing: "16px",
        }}
        styles={{
          button: { display: "none" },
        }}
      />
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

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
