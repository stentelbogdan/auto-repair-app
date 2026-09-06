"use client";

import "leaflet/dist/leaflet.css";
import { divIcon, latLngBounds } from "leaflet";
import { useEffect } from "react";
import {
  AttributionControl,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";

type RoutePoint = {
  lat: number;
  lng: number;
};

type RoutePath = Array<[number, number]>;

const pickupIcon = divIcon({
  className: "",
  html: '<div style="width:26px;height:26px;border:3px solid white;border-radius:50% 50% 50% 0;background:#f97316;box-shadow:0 3px 10px rgba(0,0,0,.45);transform:rotate(-45deg)"><div style="width:8px;height:8px;margin:6px;border-radius:50%;background:white"></div></div>',
  iconSize: [32, 38],
  iconAnchor: [16, 34],
});

const destinationIcon = divIcon({
  className: "",
  html: '<div style="width:26px;height:26px;border:3px solid #f97316;border-radius:50% 50% 50% 0;background:white;box-shadow:0 3px 10px rgba(0,0,0,.45);transform:rotate(-45deg)"><div style="width:8px;height:8px;margin:6px;border-radius:50%;background:#f97316"></div></div>',
  iconSize: [32, 38],
  iconAnchor: [16, 34],
});

function RouteBounds({
  pickup,
  destination,
  paths,
}: {
  pickup: RoutePoint;
  destination: RoutePoint;
  paths: RoutePath[];
}) {
  const map = useMap();

  useEffect(() => {
    const bounds = latLngBounds(
      [
        [pickup.lat, pickup.lng],
        [destination.lat, destination.lng],
      ],
    );

    paths.forEach((path) => {
      path.forEach(([lat, lng]) => bounds.extend([lat, lng]));
    });

    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [20, 20], maxZoom: 16 });
    }
  }, [destination, map, paths, pickup]);

  return null;
}

export default function TowingRouteMap({
  pickup,
  destination,
  paths,
}: {
  pickup: RoutePoint;
  destination: RoutePoint;
  paths: RoutePath[];
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
    <div className="mt-3 h-48 w-full overflow-hidden rounded-2xl border border-white/10">
      <MapContainer
        center={[pickup.lat, pickup.lng]}
        zoom={12}
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
        <RouteBounds
          pickup={pickup}
          destination={destination}
          paths={paths}
        />
        <TileLayer
          url={tileUrl}
          maxZoom={20}
          attribution='Powered by <a href="https://www.geoapify.com/" target="_blank">Geoapify</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap contributors</a>'
        />
        {paths.map((path, index) => (
          <Polyline
            key={index}
            positions={path}
            pathOptions={{
              color: "#f97316",
              weight: 5,
              opacity: 0.9,
              lineCap: "round",
              lineJoin: "round",
            }}
          />
        ))}
        <Marker position={[pickup.lat, pickup.lng]} icon={pickupIcon} />
        <Marker
          position={[destination.lat, destination.lng]}
          icon={destinationIcon}
        />
        <AttributionControl position="bottomright" prefix={false} />
      </MapContainer>
    </div>
  );
}
