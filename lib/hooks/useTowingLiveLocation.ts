"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { getTowingLiveLocation } from "@/lib/supabase/towing-live-tracking";
import {
  isValidTowingCoordinate,
  type TowingLiveCoordinate,
  type TowingLiveLocationRow,
} from "@/lib/towing/towing-live-tracking";

const STALE_AFTER_MS = 30_000;
const STALE_TICK_MS = 5_000;

export type TowingLiveLocationState =
  | "idle"
  | "live"
  | "stale"
  | "stopped"
  | "error";

type UseTowingLiveLocationInput = {
  requestId: string;
  enabled: boolean;
};

function getLocationState(
  row: TowingLiveLocationRow | null,
  error: string | null,
  now: number,
): TowingLiveLocationState {
  if (error) return "error";
  if (!row) return "idle";
  if (!row.is_active) return "stopped";

  const coordinate = { lat: row.latitude, lng: row.longitude };
  const updatedAt = row.position_updated_at
    ? Date.parse(row.position_updated_at)
    : Number.NaN;

  if (
    !isValidTowingCoordinate(coordinate) ||
    !Number.isFinite(updatedAt) ||
    now - updatedAt > STALE_AFTER_MS
  ) {
    return "stale";
  }

  return "live";
}

export function useTowingLiveLocation({
  requestId,
  enabled,
}: UseTowingLiveLocationInput) {
  const [row, setRow] = useState<TowingLiveLocationRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const snapshotGenerationRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    let active = true;

    const reconcile = async () => {
      const generation = ++snapshotGenerationRef.current;
      setLoading(true);

      try {
        const snapshot = await getTowingLiveLocation(requestId);
        if (!active || generation !== snapshotGenerationRef.current) return;

        setRow(snapshot);
        setError(null);
      } catch (snapshotError) {
        if (!active || generation !== snapshotGenerationRef.current) return;

        setError(
          snapshotError instanceof Error
            ? snapshotError.message
            : "Locația platformei nu a putut fi încărcată.",
        );
      } finally {
        if (active && generation === snapshotGenerationRef.current) {
          setLoading(false);
        }
      }
    };

    void reconcile();

    const channel = supabase
      .channel(`customer-towing-live-${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "towing_live_locations",
          filter: `request_id=eq.${requestId}`,
        },
        (payload) => {
          snapshotGenerationRef.current += 1;
          setNow(Date.now());
          setError(null);

          if (payload.eventType === "DELETE") {
            setRow(null);
            return;
          }

          setRow(payload.new as TowingLiveLocationRow);
        },
      )
      .subscribe((status, subscriptionError) => {
        if (status === "SUBSCRIBED") {
          void reconcile();
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError(
            subscriptionError?.message ||
              "Conexiunea live cu platforma a fost întreruptă.",
          );
        }
      });

    const staleTimer = window.setInterval(() => {
      setNow(Date.now());
    }, STALE_TICK_MS);

    return () => {
      active = false;
      snapshotGenerationRef.current += 1;
      window.clearInterval(staleTimer);
      void supabase.removeChannel(channel);
    };
  }, [enabled, requestId]);

  const coordinateCandidate = row
    ? { lat: row.latitude, lng: row.longitude }
    : null;
  const coordinate: TowingLiveCoordinate | null =
    isValidTowingCoordinate(coordinateCandidate) ? coordinateCandidate : null;

  return {
    row,
    coordinate,
    error,
    loading,
    state: enabled ? getLocationState(row, error, now) : "idle",
    now,
  };
}
