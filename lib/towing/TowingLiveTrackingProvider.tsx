"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTowingLiveTracking } from "@/lib/hooks/useTowingLiveTracking";
import { stopTowingLiveTracking } from "@/lib/supabase/towing-live-tracking";

type TrackingTarget = {
  requestId: string;
  appointmentId: string;
  etaEnabled: boolean;
};

type TrackingState = "idle" | "starting" | "active" | "disconnected" | "error";

type TrackingContextValue = {
  target: TrackingTarget | null;
  state: TrackingState;
  error: string | null;
  disconnectedRequestIds: ReadonlySet<string>;
  startTracking: (target: TrackingTarget) => Promise<boolean>;
  stopActiveTracking: () => Promise<boolean>;
  markDisconnected: (requestId: string) => void;
  setEtaEnabled: (requestId: string, enabled: boolean) => void;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function TowingLiveTrackingProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<TrackingTarget | null>(null);
  const [disconnectedRequestIds, setDisconnectedRequestIds] = useState(
    () => new Set<string>(),
  );
  const targetRef = useRef(target);
  targetRef.current = target;

  const tracking = useTowingLiveTracking({
    requestId: target?.requestId ?? "",
    appointmentId: target?.appointmentId ?? null,
    etaEnabled: target?.etaEnabled ?? false,
  });
  const trackingStartRef = useRef(tracking.start);
  const trackingStopRef = useRef(tracking.stop);
  trackingStartRef.current = tracking.start;
  trackingStopRef.current = tracking.stop;

  const pendingStartRequestIdRef = useRef<string | null>(null);
  const switchingRef = useRef(false);

  useEffect(() => {
    if (
      !target ||
      pendingStartRequestIdRef.current !== target.requestId
    ) {
      return;
    }

    pendingStartRequestIdRef.current = null;
    void trackingStartRef.current();
  }, [target]);

  const stopActiveTracking = useCallback(async () => {
    const currentTarget = targetRef.current;
    if (!currentTarget) return true;

    const stopped = await trackingStopRef.current();
    if (stopped && targetRef.current?.requestId === currentTarget.requestId) {
      setTarget(null);
    }
    return stopped;
  }, []);

  const startTracking = useCallback(async (nextTarget: TrackingTarget) => {
    if (switchingRef.current) return false;

    const currentTarget = targetRef.current;
    if (
      currentTarget?.requestId === nextTarget.requestId &&
      (tracking.state === "starting" || tracking.state === "active")
    ) {
      return true;
    }

    switchingRef.current = true;
    try {
      if (currentTarget) {
        const stopped = await trackingStopRef.current();
        if (!stopped) return false;
        if (targetRef.current?.requestId === currentTarget.requestId) {
          setTarget(null);
        }
      }

      if (disconnectedRequestIds.has(nextTarget.requestId)) {
        try {
          await stopTowingLiveTracking(nextTarget.requestId);
        } catch {
          return false;
        }
      }

      setDisconnectedRequestIds((current) => {
        if (!current.has(nextTarget.requestId)) return current;
        const next = new Set(current);
        next.delete(nextTarget.requestId);
        return next;
      });
      pendingStartRequestIdRef.current = nextTarget.requestId;
      setTarget(nextTarget);
      return true;
    } finally {
      switchingRef.current = false;
    }
  }, [disconnectedRequestIds, tracking.state]);

  const markDisconnected = useCallback((requestId: string) => {
    if (targetRef.current?.requestId === requestId) return;

    setDisconnectedRequestIds((current) => {
      if (current.has(requestId)) return current;
      const next = new Set(current);
      next.add(requestId);
      return next;
    });
  }, []);

  const setEtaEnabled = useCallback((requestId: string, enabled: boolean) => {
    setTarget((current) =>
      current?.requestId === requestId && current.etaEnabled !== enabled
        ? { ...current, etaEnabled: enabled }
        : current,
    );
  }, []);

  return (
    <TrackingContext.Provider
      value={{
        target,
        state: tracking.state,
        error: tracking.error,
        disconnectedRequestIds,
        startTracking,
        stopActiveTracking,
        markDisconnected,
        setEtaEnabled,
      }}
    >
      {children}
    </TrackingContext.Provider>
  );
}

function useTrackingContext() {
  const context = useContext(TrackingContext);
  if (!context) {
    throw new Error(
      "Towing live tracking must be used inside TowingLiveTrackingProvider.",
    );
  }
  return context;
}

export function useTowingLiveTrackingSession({
  requestId,
  appointmentId,
  etaEnabled,
}: TrackingTarget) {
  const context = useTrackingContext();
  const ownsRequest = context.target?.requestId === requestId;
  const {
    disconnectedRequestIds,
    error,
    markDisconnected: markRequestDisconnected,
    setEtaEnabled,
    startTracking,
    state,
    stopActiveTracking,
  } = context;

  useEffect(() => {
    setEtaEnabled(requestId, etaEnabled);
  }, [etaEnabled, requestId, setEtaEnabled]);

  const start = useCallback(
    () => startTracking({ requestId, appointmentId, etaEnabled }),
    [appointmentId, etaEnabled, requestId, startTracking],
  );
  const stop = useCallback(async () => {
    if (!ownsRequest) {
      try {
        await stopTowingLiveTracking(requestId);
        return true;
      } catch {
        return false;
      }
    }
    return stopActiveTracking();
  }, [ownsRequest, requestId, stopActiveTracking]);
  const markDisconnected = useCallback(
    () => markRequestDisconnected(requestId),
    [markRequestDisconnected, requestId],
  );

  return {
    state: ownsRequest
      ? state
      : disconnectedRequestIds.has(requestId)
        ? ("disconnected" as const)
        : ("idle" as const),
    error: ownsRequest ? error : null,
    start,
    stop,
    markDisconnected,
  };
}

export function useTowingLiveTrackingControl() {
  const context = useTrackingContext();
  return { stopActiveTracking: context.stopActiveTracking };
}
