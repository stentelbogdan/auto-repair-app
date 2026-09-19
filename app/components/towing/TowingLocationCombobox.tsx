"use client";

import GeoLocationCombobox, {
  type GeoLocationOption,
} from "@/app/components/GeoLocationCombobox";
import { romaniaCities } from "@/lib/data/romania-cities";

export type TowingLocationSuggestion = GeoLocationOption;

type TowingLocationComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (suggestion: TowingLocationSuggestion) => void;
  biasLat?: number;
  biasLng?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("ro-RO");
}

function getLocalSuggestions(value: string): TowingLocationSuggestion[] {
  const normalizedValue = normalizeSearchText(value);
  if (!normalizedValue) return [];

  return romaniaCities
    .map((city) => ({ city, normalized: normalizeSearchText(city) }))
    .filter(({ normalized }) => normalized.includes(normalizedValue))
    .sort((first, second) => {
      const getRank = (candidate: string) =>
        candidate === normalizedValue
          ? 0
          : candidate.startsWith(normalizedValue)
            ? 1
            : 2;

      return (
        getRank(first.normalized) - getRank(second.normalized) ||
        first.city.localeCompare(second.city)
      );
    })
    .slice(0, 8)
    .map(({ city }) => ({
      id: `local-${city}`,
      city,
      label: `${city}, România`,
      region: null,
      country: "România",
      countryCode: "RO",
      postalCode: null,
      lat: null,
      lng: null,
      location: null,
    }));
}

export default function TowingLocationCombobox({
  value,
  onChange,
  onSelect,
  ...props
}: TowingLocationComboboxProps) {
  return (
    <GeoLocationCombobox
      {...props}
      value={value}
      onChange={onChange}
      onSelect={(suggestion) => onSelect?.(suggestion)}
      localSuggestions={getLocalSuggestions(value)}
    />
  );
}
