"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  stopTowingLiveTracking,
  upsertTowingLiveLocation,
} from "@/lib/supabase/towing-live-tracking";

const MIN_PUBLISH_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MIN_MOVEMENT_METERS = 15;
// Fixurile peste acest prag sunt prea imprecise pentru tracking-ul MVP.
const MAX_ACCURACY_METERS = 120;

type TrackingState = "idle" | "starting" | "active" | "disconnected" | "error";

type PublishedPosition = {
  latitude: number;
  longitude: number;
  publishedAt: number;
};

type ValidGpsPosition = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  headingDegrees: number | null;
  speedMps: number | null;
};

type UseTowingLiveTrackingInput = {
  requestId: string;
  appointmentId: string | null;
};

function distanceInMeters(
  first: Pick<PublishedPosition, "latitude" | "longitude">,
  second: Pick<PublishedPosition, "latitude" | "longitude">,
) {
  const earthRadiusMeters = 6_371_000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  const longitudeDelta = toRadians(second.longitude - first.longitude);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);

  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function getGeolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Permisiunea pentru locație a fost refuzată.";
  }

  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Locația nu este disponibilă momentan.";
  }

  if (error.code === error.TIMEOUT) {
    return "Localizarea a durat prea mult. Încearcă din nou.";
  }

  return "Locația nu a putut fi obținută.";
}

export function useTowingLiveTracking({
  requestId,
  appointmentId,
}: UseTowingLiveTrackingInput) {
  const [state, setState] = useState<TrackingState>("idle");
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const watchIdRef = useRef<number | null>(null);
  const heartbeatIntervalRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const lastPublishedRef = useRef<PublishedPosition | null>(null);
  const lastValidPositionRef = useRef<ValidGpsPosition | null>(null);
  const publishPromiseRef = useRef<Promise<void> | null>(null);

  const clearLocalPublisher = () => {
    generationRef.current += 1;

    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (heartbeatIntervalRef.current !== null) {
      window.clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    lastPublishedRef.current = null;
    lastValidPositionRef.current = null;
  };

  const stop = async () => {
    clearLocalPublisher();
    setState("idle");
    setError(null);

    const pendingPublish = publishPromiseRef.current;
    if (pendingPublish) {
      try {
        await pendingPublish;
      } catch {
        // Stop-ul remote trebuie să rămână ultima operație chiar dacă publish-ul a eșuat.
      }
    }

    try {
      await stopTowingLiveTracking(requestId);
    } catch (stopError) {
      if (mountedRef.current) {
        setState("error");
        setError(
          stopError instanceof Error
            ? stopError.message
            : "Trackingul nu a putut fi oprit pe server.",
        );
      }
      return false;
    }

    return true;
  };

  const start = async () => {
    if (state === "starting" || state === "active") return;

    if (!appointmentId) {
      setState("error");
      setError("Programarea confirmată nu a fost găsită.");
      return;
    }

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState("error");
      setError("Acest browser nu suportă accesul la locație.");
      return;
    }

    clearLocalPublisher();
    const generation = generationRef.current;
    setState("starting");
    setError(null);

    if (state === "disconnected") {
      try {
        await stopTowingLiveTracking(requestId);
      } catch (stopError) {
        if (generationRef.current === generation && mountedRef.current) {
          setState("error");
          setError(
            stopError instanceof Error
              ? stopError.message
              : "Sesiunea anterioară de tracking nu a putut fi închisă.",
          );
        }
        return;
      }
    }

    if (generationRef.current !== generation || !mountedRef.current) return;

    const publishPosition = (
      position: ValidGpsPosition,
      heartbeatOnly: boolean,
    ) => {
      if (generationRef.current !== generation || publishPromiseRef.current) {
        return;
      }

      const now = Date.now();
      const lastPublished = lastPublishedRef.current;

      if (lastPublished) {
        const elapsed = now - lastPublished.publishedAt;

        if (heartbeatOnly) {
          if (elapsed < HEARTBEAT_INTERVAL_MS) return;
        } else {
          if (elapsed < MIN_PUBLISH_INTERVAL_MS) return;

          const moved = distanceInMeters(lastPublished, position);
          if (moved < MIN_MOVEMENT_METERS && elapsed < HEARTBEAT_INTERVAL_MS) {
            return;
          }
        }
      }

      const publishPromise = upsertTowingLiveLocation({
        requestId,
        appointmentId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: position.accuracyMeters,
        headingDegrees: position.headingDegrees,
        speedMps: position.speedMps,
      });
      publishPromiseRef.current = publishPromise;

      void publishPromise
        .then(() => {
          if (generationRef.current !== generation || !mountedRef.current) {
            return;
          }

          lastPublishedRef.current = {
            latitude: position.latitude,
            longitude: position.longitude,
            publishedAt: Date.now(),
          };
          setState("active");
          setError(null);
        })
        .catch((publishError) => {
          if (generationRef.current !== generation || !mountedRef.current) {
            return;
          }

          clearLocalPublisher();
          setState("error");
          setError(
            publishError instanceof Error
              ? publishError.message
              : "Locația nu a putut fi transmisă clientului.",
          );
        })
        .finally(() => {
          if (publishPromiseRef.current === publishPromise) {
            publishPromiseRef.current = null;
          }
        });
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        if (generationRef.current !== generation) return;

        const { coords } = position;
        if (
          !Number.isFinite(coords.latitude) ||
          !Number.isFinite(coords.longitude) ||
          !Number.isFinite(coords.accuracy) ||
          coords.accuracy < 0 ||
          coords.accuracy > MAX_ACCURACY_METERS
        ) {
          return;
        }

        const headingDegrees =
          coords.heading !== null &&
          Number.isFinite(coords.heading) &&
          coords.heading >= 0 &&
          coords.heading < 360
            ? coords.heading
            : null;
        const speedMps =
          coords.speed !== null &&
          Number.isFinite(coords.speed) &&
          coords.speed >= 0
            ? coords.speed
            : null;

        const validPosition: ValidGpsPosition = {
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracyMeters: coords.accuracy,
          headingDegrees,
          speedMps,
        };

        lastValidPositionRef.current = validPosition;
        publishPosition(validPosition, false);
      },
      (geolocationError) => {
        if (generationRef.current !== generation || !mountedRef.current) return;

        clearLocalPublisher();
        setState("error");
        setError(getGeolocationErrorMessage(geolocationError));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
      },
    );

    heartbeatIntervalRef.current = window.setInterval(() => {
      if (generationRef.current !== generation) return;

      const lastValidPosition = lastValidPositionRef.current;
      if (lastValidPosition) {
        publishPosition(lastValidPosition, true);
      }
    }, MIN_PUBLISH_INTERVAL_MS);
  };

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearLocalPublisher();
    };
  }, []);

  const markDisconnected = useCallback(() => {
    setState("disconnected");
    setError(null);
  }, []);

  return {
    state,
    error,
    start,
    stop,
    markDisconnected,
  };
}
