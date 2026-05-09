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
};

export default function ChatPage() {
  const params = useParams();
  const requestId = params.requestId as string;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [userId, setUserId] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    loadMessages();
    getUser();

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
          setMessages((prev) => [...prev, payload.new as Message]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages]);

  const getUser = async () => {
    const { data } = await supabase.auth.getUser();

    if (data.user) {
      setUserId(data.user.id);
    }
  };

  const loadMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data);
    }
  };

  const sendMessage = async () => {
    if (!newMessage.trim()) return;

    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) return;

    await supabase.from("messages").insert({
      request_id: requestId,
      sender_id: authData.user.id,
      sender_role: "user",
      message: newMessage,
    });

    setNewMessage("");
  };

  return (
    <main className="flex h-screen flex-col bg-black text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <h1 className="text-xl font-bold">Conversație</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {messages.map((message) => {
            const isMine = message.sender_id === userId;

            return (
              <div
                key={message.id}
                className={`max-w-[80%] rounded-3xl px-4 py-3 text-sm leading-6 ${
                  isMine
                    ? "ml-auto bg-white text-black"
                    : "bg-white/10 text-white"
                }`}
              >
                {message.message}
              </div>
            );
          })}

          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-white/10 bg-black/90 p-4">
        <div className="mx-auto flex max-w-3xl gap-3">
          <input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Scrie un mesaj..."
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none"
          />

          <button
            onClick={sendMessage}
            className="rounded-2xl bg-white px-5 py-3 font-semibold text-black"
          >
            Trimite
          </button>
        </div>
      </div>
    </main>
  );
}