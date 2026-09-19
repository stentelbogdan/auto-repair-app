"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  normalizeGeoLocation,
  type GeoLocation,
} from "@/lib/geo/geo-location";

export type GeoLocationOption = {
  id: string;
  city: string;
  label: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  location: GeoLocation | null;
};

type GeoLocationComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (suggestion: GeoLocationOption) => void;
  getSelectionValue?: (suggestion: GeoLocationOption) => string;
  localSuggestions?: GeoLocationOption[];
  biasLat?: number;
  biasLng?: number;
  placeholder?: string;
  required?: boolean;
  className?: string;
  ariaLabel?: string;
};

type AutocompleteResponse = { suggestions?: unknown[] };

function normalizeOption(value: unknown): GeoLocationOption | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const option = value as Record<string, unknown>;
  const locationValue = option.location;
  if (
    typeof locationValue !== "object" ||
    locationValue === null ||
    Array.isArray(locationValue)
  ) {
    return null;
  }

  const locationRecord = locationValue as Record<string, unknown>;
  const location = normalizeGeoLocation({
    locality: locationRecord.locality,
    postalCode: locationRecord.postalCode,
    countryCode: locationRecord.countryCode,
    lat: locationRecord.lat,
    lng: locationRecord.lng,
  });
  const id = typeof option.id === "string" ? option.id.trim() : "";
  const label = typeof option.label === "string" ? option.label.trim() : "";
  if (!id || !label || !location) return null;

  const optionalText = (key: string) =>
    typeof option[key] === "string" && option[key].trim()
      ? option[key].trim()
      : null;

  return {
    id,
    city: location.locality,
    label,
    region: optionalText("region"),
    country: optionalText("country"),
    countryCode: location.countryCode,
    postalCode: location.postalCode,
    lat: location.lat,
    lng: location.lng,
    location,
  };
}

function combineSuggestions(local: GeoLocationOption[], remote: GeoLocationOption[]) {
  return [...local, ...remote].filter((suggestion, index, suggestions) => {
    return !suggestions.slice(0, index).some((existing) => {
      if (existing.id === suggestion.id) return true;
      if (!existing.location || !suggestion.location) return false;

      return existing.location.lat === suggestion.location.lat &&
        existing.location.lng === suggestion.location.lng;
    });
  });
}

export default function GeoLocationCombobox({
  value,
  onChange,
  onSelect,
  getSelectionValue = (suggestion) => suggestion.city,
  localSuggestions = [],
  biasLat,
  biasLng,
  placeholder = "Scrie localitatea",
  required = false,
  className,
  ariaLabel = "Oraș / Localitate",
}: GeoLocationComboboxProps) {
  const listboxId = useId();
  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedValueRef = useRef<string | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<GeoLocationOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const suggestions = combineSuggestions(localSuggestions, remoteSuggestions);

  useEffect(() => {
    const requestSequence = ++requestSequenceRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setRemoteSuggestions([]);
    setErrorMessage(null);
    setHasSearched(false);
    setIsLoading(false);

    const text = value.trim();
    if (selectedValueRef.current === value) {
      selectedValueRef.current = null;
      return;
    }
    if (text.length < 3) return;

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      requestControllerRef.current = controller;
      setIsLoading(true);

      try {
        const hasValidBias = typeof biasLat === "number" && Number.isFinite(biasLat) &&
          typeof biasLng === "number" && Number.isFinite(biasLng);
        const response = await fetch("/api/geocoding/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, ...(hasValidBias ? { lat: biasLat, lng: biasLng } : {}) }),
          signal: controller.signal,
        });

        if (!response.ok) throw new Error("Autocomplete failed.");
        const result = (await response.json()) as AutocompleteResponse;
        if (
          requestControllerRef.current !== controller ||
          requestSequenceRef.current !== requestSequence
        ) return;
        const normalizedSuggestions = Array.isArray(result.suggestions)
          ? result.suggestions
              .map(normalizeOption)
              .filter((suggestion): suggestion is GeoLocationOption => Boolean(suggestion))
          : [];
        setRemoteSuggestions(normalizedSuggestions);
        setHasSearched(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (
          requestControllerRef.current !== controller ||
          requestSequenceRef.current !== requestSequence
        ) return;
        setErrorMessage("Localitățile nu au putut fi încărcate.");
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
          setIsLoading(false);
        }
      }
    }, 350);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [biasLat, biasLng, value]);

  useEffect(() => setActiveIndex(-1), [value]);

  function selectSuggestion(suggestion: GeoLocationOption) {
    const selectionValue = getSelectionValue(suggestion);
    requestSequenceRef.current += 1;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setRemoteSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    selectedValueRef.current = selectionValue;
    onChange(selectionValue);
    onSelect(suggestion);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    selectedValueRef.current = null;
    setIsOpen(true);
    onChange(event.target.value);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => current < suggestions.length - 1 ? current + 1 : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => current > 0 ? current - 1 : suggestions.length - 1);
    } else if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) selectSuggestion(suggestion);
    }
  }

  const showEmpty = isOpen && hasSearched && !isLoading && !errorMessage && suggestions.length === 0;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        required={required}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={isOpen && suggestions.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
      />

      {isOpen && suggestions.length === 0 && (isLoading || errorMessage || showEmpty) && (
        <div className="absolute inset-x-0 top-full z-[1100] mt-1 rounded-2xl border border-white/15 bg-neutral-950 px-3 py-3 text-sm text-white/60 shadow-2xl shadow-black/50">
          {isLoading ? "Se caută localități..." : errorMessage ?? "Nu am găsit localități pentru această căutare."}
        </div>
      )}

      {isOpen && suggestions.length > 0 && (
        <div id={listboxId} role="listbox" className="absolute inset-x-0 top-full z-[1100] mt-1 max-h-64 overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950 p-1 shadow-2xl shadow-black/50">
          {suggestions.map((suggestion, index) => (
            <button
              key={suggestion.id}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              className={`flex min-h-11 w-full flex-col justify-center rounded-xl px-3 py-2 text-left transition ${activeIndex === index ? "bg-orange-500/15 text-orange-200" : "text-white hover:bg-white/10"}`}
            >
              <span className="text-sm font-semibold">{suggestion.city}</span>
              {(suggestion.region || suggestion.country) && (
                <span className="mt-0.5 text-xs text-white/50">
                  {[suggestion.region, suggestion.postalCode, suggestion.country]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
