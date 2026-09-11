"use client";

import "leaflet/dist/leaflet.css";
import { divIcon, latLngBounds } from "leaflet";
import { useEffect, useRef } from "react";
import {
  AttributionControl,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from "react-leaflet";
import type { TowingLiveCoordinate } from "@/lib/towing/towing-live-tracking";

const pickupIcon = divIcon({
  className: "",
  html: '<div style="width:26px;height:26px;border:3px solid white;border-radius:50% 50% 50% 0;background:#f97316;box-shadow:0 3px 10px rgba(0,0,0,.45);transform:rotate(-45deg)"><div style="width:8px;height:8px;margin:6px;border-radius:50%;background:white"></div></div>',
  iconSize: [32, 38],
  iconAnchor: [16, 34],
});

const platformIcon = divIcon({
  className: "",
  html: '<div style="width:28px;height:28px;border:3px solid white;border-radius:50%;background:#10b981;box-shadow:0 3px 12px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;color:white;font-size:15px;font-weight:900">T</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});

function InitialPlatformBounds({
  pickup,
  platform,
}: {
  pickup: TowingLiveCoordinate;
  platform: TowingLiveCoordinate | null;
}) {
  const map = useMap();
  const fittedPlatformRef = useRef(false);

  useEffect(() => {
    if (!platform || fittedPlatformRef.current) return;

    const bounds = latLngBounds([
      [pickup.lat, pickup.lng],
      [platform.lat, platform.lng],
    ]);

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
      fittedPlatformRef.current = true;
    }
  }, [map, pickup, platform]);

  return null;
}

export default function TowingLiveTrackingMap({
  pickup,
  platform,
}: {
  pickup: TowingLiveCoordinate;
  platform: TowingLiveCoordinate | null;
}) {
  const mapsKey = process.env.NEXT_PUBLIC_GEOAPIFY_MAPS_KEY;

  if (!mapsKey) {
    return (
      <div className="mt-3 flex h-48 w-full items-center justify-center rounded-2xl border border-white/10 bg-black/30 px-4 text-center text-sm text-white/50">
        Harta nu este disponibilă momentan.
      </div>
    );
  }

  const tileScale = window.devicePixelRatio > 1 ? "@2x" : "";
  const tileUrl = `https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}${tileScale}.png?apiKey=${mapsKey}`;

  return (
    <div className="relative isolate z-0 mt-3 h-48 w-full overflow-hidden rounded-2xl border border-white/10">
      <MapContainer
        center={[pickup.lat, pickup.lng]}
        zoom={14}
        minZoom={2}
        maxZoom={20}
        zoomControl
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        touchZoom
        boxZoom={false}
        keyboard={false}
        attributionControl={false}
        className="h-full w-full"
      >
        <InitialPlatformBounds pickup={pickup} platform={platform} />
        <TileLayer
          url={tileUrl}
          maxZoom={20}
          attribution='Powered by <a href="https://www.geoapify.com/" target="_blank">Geoapify</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
        />
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
        {platform && (
          <Marker
            position={[platform.lat, platform.lng]}
            icon={platformIcon}
          />
        )}
        <AttributionControl position="bottomright" prefix={false} />
      </MapContainer>
    </div>
  );
}
