"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type Message = {
  id: string;
  request_id: string;
  sender_id: string;
  sender_role: string;
  message: string;
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
};

const quickMessages = [
  "Când pot aduce mașina?",
  "Cât durează lucrarea?",
  "Mașina este gata?",
  "Poți să îmi trimiți poze cu progresul?",
];

export default function ChatPage() {
  const params = useParams();
  const requestId = params.requestId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [userId, setUserId] = useState("");
  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [sendingQuickMessage, setSendingQuickMessage] = useState(false);
  const [isOtherTyping, setIsOtherTyping] = useState(false);
  const [activeRole, setActiveRole] = useState<string>("customer");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<any>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const stopTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const savedRole = localStorage.getItem("activeRole");
    if (savedRole) setActiveRole(savedRole);

    loadMessages();
    getUser();
    loadRequest();

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
          const newMessage = payload.new as Message;

          setMessages((prev) => {
            if (prev.some((message) => message.id === newMessage.id)) {
              return prev;
            }

            return [...prev, newMessage];
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
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (stopTypingTimeoutRef.current)
        clearTimeout(stopTypingTimeoutRef.current);
      supabase.removeChannel(channel);
    };
  }, [requestId, userId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, isOtherTyping]);

  useEffect(() => {
    markIncomingMessagesAsRead();
  }, [messages, userId]);

  const getUser = async () => {
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      setUserId(data.user.id);
    }
  };

  const loadRequest = async () => {
    const { data, error } = await supabase
      .from("repair_requests")
      .select(
        `
        car_brand,
        car_model,
        city,
        status,
        images
      `,
      )
      .eq("id", requestId)
      .single<RequestData>();

    if (!error && data) {
      setRequestData(data);
    }
  };

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (error) return;

    if (data && data.length > 0) {
      setMessages(data);
      return;
    }

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) return;

    await supabase.from("messages").insert({
      request_id: requestId,
      sender_id: authData.user.id,
      sender_role: "system",
      message:
        "Conversația a fost începută. Puteți discuta aici despre această lucrare.",
    });
  };

  const markIncomingMessagesAsRead = async () => {
    if (!userId || messages.length === 0) return;

    const unreadMessageIds = messages
      .filter(
        (message) =>
          message.sender_id !== userId &&
          message.sender_role !== "system" &&
          !message.read_at,
      )
      .map((message) => message.id);

    if (unreadMessageIds.length === 0) return;

    await supabase
      .from("messages")
      .update({ read_at: new Date().toISOString() })
      .in("id", unreadMessageIds);
  };

  const insertMessage = async (text: string) => {
    const cleanText = text.trim();
    if (!cleanText) return;

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) return;

    await supabase.from("messages").insert({
      request_id: requestId,
      sender_id: authData.user.id,
      sender_role: "user",
      message: cleanText,
    });
  };

  const sendMessage = async () => {
    const text = newMessage.trim();
    if (!text) return;

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      alert("Nu ești logat.");
      return;
    }

    const { error } = await supabase.from("messages").insert({
      request_id: requestId,
      sender_id: authData.user.id,
      sender_role: "user",
      message: text,
    });

    if (error) {
      console.error("Failed to send message:", error);
      alert("Mesajul nu a putut fi trimis.");
      return;
    }

    setNewMessage("");
    sendTypingStatus(false);
  };

  const sendQuickMessage = async (text: string) => {
    try {
      setSendingQuickMessage(true);
      await insertMessage(text);
    } finally {
      setSendingQuickMessage(false);
    }
  };

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

  const handleInputChange = (value: string) => {
    setNewMessage(value);
    sendTypingStatus(value.trim().length > 0);

    if (stopTypingTimeoutRef.current) {
      clearTimeout(stopTypingTimeoutRef.current);
    }

    stopTypingTimeoutRef.current = setTimeout(() => {
      sendTypingStatus(false);
    }, 1200);
  };

  const firstImage =
    requestData?.images?.[0]?.url || requestData?.images?.[0]?.dataUrl || "";

  const lastOwnMessageId = [...messages]
    .reverse()
    .find(
      (message) =>
        message.sender_id === userId && message.sender_role !== "system",
    )?.id;

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

          <div>
            <h1 className="text-lg font-bold text-white">
              {requestData?.car_brand || "Lucrare"}{" "}
              {requestData?.car_model || ""}
            </h1>

            <p className="text-sm text-white/50">
              {requestData?.city || "-"} • {formatStatus(requestData?.status)}
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-52">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.length === 0 && (
            <div className="mx-auto mt-10 max-w-sm rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-center text-sm leading-6 text-white/55">
              Conversația a fost creată. Scrie primul mesaj despre această
              lucrare.
            </div>
          )}

          {messages.map((message) => {
            const isSystem = message.sender_role === "system";
            const isMine = message.sender_id === userId && !isSystem;
            const isLastOwnMessage = message.id === lastOwnMessageId;

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
                  className={`rounded-3xl px-4 py-3 text-sm leading-6 ${
                    isMine ? "bg-white text-black" : "bg-white/10 text-white"
                  }`}
                >
                  {message.message}
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
              {activeRole === "workshop" ? "Clientul" : "Service-ul"} scrie...
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/10 bg-black/95 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {quickMessages.map((text) => (
              <button
                key={text}
                type="button"
                disabled={sendingQuickMessage}
                onClick={() => sendQuickMessage(text)}
                className="shrink-0 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white/80 transition active:scale-[0.98] disabled:opacity-50"
              >
                {text}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <input
              value={newMessage}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Scrie un mesaj..."
              className="h-14 flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 text-white outline-none placeholder:text-white/35"
            />

            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="rounded-2xl bg-white px-5 py-3 font-semibold text-black active:scale-[0.98]"
            >
              Trimite
            </button>
          </div>
        </div>
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

function formatTime(date: string) {
  return new Date(date).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}
