"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  formatTowingRouteDistance,
  formatTowingRouteDuration,
} from "@/lib/towing/towing-display";
import {
  isValidTowingRoutePaths,
  type TowingRoutePaths,
} from "@/lib/towing/towing-route";

const TowingRouteMap = dynamic(
  () => import("@/app/components/towing/TowingRouteMap"),
  { ssr: false },
);

type RoutePoint = {
  lat: number;
  lng: number;
};

type FallbackState =
  | { status: "idle" }
  | { status: "loading" | "error"; routeKey: string }
  | { status: "success"; routeKey: string; paths: TowingRoutePaths };

type TowingRouteEstimateCardProps = {
  distanceMeters: number | null;
  durationSeconds: number | null;
  pickup?: RoutePoint | null;
  destination?: RoutePoint | null;
  paths?: TowingRoutePaths | null;
};

export default function TowingRouteEstimateCard({
  distanceMeters,
  durationSeconds,
  pickup,
  destination,
  paths,
}: TowingRouteEstimateCardProps) {
  const cardRef = useRef<HTMLElement | null>(null);
  const [mapActivated, setMapActivated] = useState(false);
  const [fallbackState, setFallbackState] = useState<FallbackState>({
    status: "idle",
  });
  const snapshotPaths = isValidTowingRoutePaths(paths) ? paths : null;
  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const destinationLat = destination?.lat ?? null;
  const destinationLng = destination?.lng ?? null;
  const hasValidMetrics =
    isNonNegativeFinite(distanceMeters) &&
    isNonNegativeFinite(durationSeconds);
  const hasValidCoordinates =
    isLatitude(pickupLat) &&
    isLongitude(pickupLng) &&
    isLatitude(destinationLat) &&
    isLongitude(destinationLng);
  const validPickup: RoutePoint | null = hasValidCoordinates
    ? { lat: pickupLat, lng: pickupLng }
    : null;
  const validDestination: RoutePoint | null = hasValidCoordinates
    ? { lat: destinationLat, lng: destinationLng }
    : null;
  const routeKey = hasValidCoordinates
    ? `${pickupLat},${pickupLng}|${destinationLat},${destinationLng}`
    : null;

  useEffect(() => {
    const card = cardRef.current;
    if (!card || !hasValidMetrics || !routeKey) return;

    const controller = new AbortController();
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;

        observer.disconnect();
        setMapActivated(true);

        if (snapshotPaths) return;

        setFallbackState({ status: "loading", routeKey });
        void fetch("/api/routing/towing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickupLat,
            pickupLng,
            destinationLat,
            destinationLng,
          }),
          signal: controller.signal,
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("Route geometry unavailable");

            const payload: unknown = await response.json();
            const fallbackPaths = getFallbackPaths(payload);
            if (!fallbackPaths) throw new Error("Invalid route geometry");

            setFallbackState({
              status: "success",
              routeKey,
              paths: fallbackPaths,
            });
          })
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            setFallbackState({ status: "error", routeKey });
          });
      },
      { rootMargin: "200px 0px" },
    );

    observer.observe(card);
    return () => {
      observer.disconnect();
      controller.abort();
    };
  }, [
    destinationLat,
    destinationLng,
    hasValidMetrics,
    pickupLat,
    pickupLng,
    routeKey,
    snapshotPaths,
  ]);

  if (!hasValidMetrics) return null;

  const displayedPaths =
    snapshotPaths ??
    (fallbackState.status === "success" && fallbackState.routeKey === routeKey
      ? fallbackState.paths
      : null);
  const fallbackFailed =
    fallbackState.status === "error" && fallbackState.routeKey === routeKey;

  return (
    <section
      ref={cardRef}
      className="mb-4 rounded-2xl border border-white/10 bg-neutral-950 p-4 text-white"
    >
      <h2 className="text-base font-black">Traseu estimat</h2>
      <p className="mt-2 text-lg font-bold text-orange-300">
        {formatTowingRouteDistance(distanceMeters)} ·{" "}
        {formatTowingRouteDuration(durationSeconds)}
      </p>

      {validPickup &&
        validDestination &&
        (mapActivated && displayedPaths ? (
          <TowingRouteMap
            pickup={validPickup}
            destination={validDestination}
            paths={displayedPaths}
          />
        ) : fallbackFailed ? (
          <div className="mt-3 flex h-48 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center text-sm text-white/50">
            Harta traseului nu este disponibilă momentan.
          </div>
        ) : (
          <div className="mt-3 h-48 animate-pulse rounded-2xl border border-white/10 bg-white/[0.06]" />
        ))}
    </section>
  );
}

function isNonNegativeFinite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isLatitude(value: number | null): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isLongitude(value: number | null): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function getFallbackPaths(payload: unknown) {
  if (typeof payload !== "object" || payload === null || !("route" in payload)) {
    return null;
  }

  const route = payload.route;
  if (typeof route !== "object" || route === null || !("paths" in route)) {
    return null;
  }

  return isValidTowingRoutePaths(route.paths) ? route.paths : null;
}
