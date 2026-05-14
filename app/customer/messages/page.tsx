"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MessagesRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    const savedRole = localStorage.getItem("activeRole");

    if (savedRole === "workshop") {
      router.replace("/workshops/messages");
      return;
    }

    router.replace("/customer/messages");
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-black text-white">
      Se deschide inbox-ul...
    </main>
  );
}