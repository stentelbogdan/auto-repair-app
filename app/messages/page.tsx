"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MessagesPage() {
  const router = useRouter();

  useEffect(() => {
    const savedRole = localStorage.getItem("activeRole");

    if (savedRole === "workshop") {
      router.replace("/workshops/messages");
    } else {
      router.replace("/customer/messages");
    }
  }, [router]);

  return (
    <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
      <p className="text-sm text-white/65">Se incarca mesajele...</p>
    </main>
  );
}
