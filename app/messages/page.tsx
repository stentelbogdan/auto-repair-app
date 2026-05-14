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

  return null;
}