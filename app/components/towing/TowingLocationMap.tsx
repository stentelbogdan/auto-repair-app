"use client";

import "leaflet/dist/leaflet.css";
import { divIcon, type Marker as LeafletMarker } from "leaflet";
import { useEffect, useRef } from "react";
import {
  AttributionControl,
  MapContainer,
  Marker,
  TileLayer,
  useMap,
} from "react-leaflet";

const locationIcon = divIcon({
  className: "",
  html: '<div style="width:26px;height:26px;border:3px solid white;border-radius:50% 50% 50% 0;background:#f97316;box-shadow:0 3px 10px rgba(0,0,0,.45);transform:rotate(-45deg)"><div style="width:8px;height:8px;margin:6px;border-radius:50%;background:white"></div></div>',
  iconSize: [32, 38],
  iconAnchor: [16, 34],
});

function MapPositionSync({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();

  useEffect(() => {
    map.panTo([lat, lng]);
  }, [lat, lng, map]);

  return null;
}

export default function TowingLocationMap({
  lat,
  lng,
  onPositionChange,
}: {
  lat: number;
  lng: number;
  onPositionChange: (lat: number, lng: number) => void;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const mapsKey = process.env.NEXT_PUBLIC_GEOAPIFY_MAPS_KEY;

  if (!mapsKey) {
    return (
      <div className="mt-3 flex h-44 w-full items-center justify-center rounded-2xl border border-white/10 bg-black/30 px-4 text-center text-sm text-white/50">
        Harta nu este disponibilă momentan.
      </div>
    );
  }

  const tileScale = window.devicePixelRatio > 1 ? "@2x" : "";
  const tileUrl = `https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}${tileScale}.png?apiKey=${mapsKey}`;

  return (
    <div className="mt-3 h-44 w-full overflow-hidden rounded-2xl border border-white/10">
      <MapContainer
        center={[lat, lng]}
        zoom={17}
        minZoom={12}
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
        <MapPositionSync lat={lat} lng={lng} />
        <TileLayer
          url={tileUrl}
          maxZoom={20}
          attribution='Powered by <a href="https://www.geoapify.com/" target="_blank">Geoapify</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
        />
        <Marker
          ref={markerRef}
          position={[lat, lng]}
          icon={locationIcon}
          draggable
          eventHandlers={{
            dragend: () => {
              const position = markerRef.current?.getLatLng();
              if (position) onPositionChange(position.lat, position.lng);
            },
          }}
        />
        <AttributionControl position="bottomright" prefix={false} />
      </MapContainer>
    </div>
  );
}
