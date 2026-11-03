"use client";
import { useEffect, useRef } from "react";

// Only already-rendered, authorized cards carry these attributes. URL parameters
// select a card; they never authorize a request or mark anything as read.
export function useNotificationFocus() {
  const focused = useRef("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const offer = params.get("focusOffer");
    const request = params.get("focusRequest");
    const id = offer || request;
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return;
    const key = `${offer ? "offer" : "request"}:${id}`;
    if (focused.current === key) return;
    const element = document.querySelector<HTMLElement>(`[data-focus-${offer ? "offer" : "request"}="${id}"]`);
    if (!element) return;
    focused.current = key;
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    element.classList.add("ring-2", "ring-orange-500");
  });
}
