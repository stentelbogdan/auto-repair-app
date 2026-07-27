"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import Car3DViewer from "./Car3DViewer";

type SlotRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

export default function PersistentDashboardCar() {
  const pathname = usePathname();

  const [slotRect, setSlotRect] = useState<SlotRect | null>(null);

  const lastValidRectRef = useRef<SlotRect | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameRef = useRef<number | null>(null);

  const isDashboard = pathname === "/customer/dashboard";

  const updatePosition = useCallback(() => {
    const slot = document.getElementById("dashboard-car-slot");

    if (!slot) {
      return false;
    }

    const rect = slot.getBoundingClientRect();

    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const nextRect: SlotRect = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    };

    lastValidRectRef.current = nextRect;
    setSlotRect(nextRect);

    return true;
  }, []);

  useEffect(() => {
    if (!isDashboard) {
      return;
    }

    let cancelled = false;

    const findAndObserveSlot = () => {
      if (cancelled) return;

      const slot = document.getElementById("dashboard-car-slot");

      if (!slot) {
        frameRef.current = window.requestAnimationFrame(findAndObserveSlot);
        return;
      }

      const hasValidPosition = updatePosition();

      if (!hasValidPosition) {
        frameRef.current = window.requestAnimationFrame(findAndObserveSlot);
        return;
      }

      resizeObserverRef.current?.disconnect();

      resizeObserverRef.current = new ResizeObserver(() => {
        updatePosition();
      });

      resizeObserverRef.current.observe(slot);
    };

    findAndObserveSlot();

    const handleViewportChange = () => {
      updatePosition();
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      cancelled = true;

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;

      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [isDashboard, updatePosition]);

  const activeRect = slotRect ?? lastValidRectRef.current;
  const shouldShowCar = isDashboard && activeRect !== null;

  return (
    <div
      aria-hidden={!shouldShowCar}
      className={`fixed z-20 overflow-hidden rounded-[32px] transition-opacity duration-150 ${
        shouldShowCar
          ? "pointer-events-auto opacity-100"
          : "pointer-events-none opacity-0"
      }`}
      style={{
        top: activeRect?.top ?? 0,
        left: activeRect?.left ?? 0,
        width: activeRect?.width ?? 0,
        height: activeRect?.height ?? 0,
      }}
    >
      <Car3DViewer mode="preview" heightClassName="h-full" />
    </div>
  );
}