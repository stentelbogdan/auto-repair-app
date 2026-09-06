"use client";

import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { romaniaCities } from "@/lib/data/romania-cities";

export type TowingLocationSuggestion = {
  id: string;
  city: string;
  label: string;
  region: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
};

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

type AutocompleteResponse = {
  suggestions?: TowingLocationSuggestion[];
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
      countryCode: "ro",
      lat: null,
      lng: null,
    }));
}

function combineSuggestions(
  local: TowingLocationSuggestion[],
  remote: TowingLocationSuggestion[],
) {
  return [...local, ...remote].filter((suggestion, index, suggestions) => {
    const city = normalizeSearchText(suggestion.city);
    const region = normalizeSearchText(suggestion.region ?? "");
    const country = normalizeSearchText(
      suggestion.countryCode ?? suggestion.country ?? "",
    );

    return !suggestions.slice(0, index).some((existing) => {
      const existingCity = normalizeSearchText(existing.city);
      const existingRegion = normalizeSearchText(existing.region ?? "");
      const existingCountry = normalizeSearchText(
        existing.countryCode ?? existing.country ?? "",
      );

      return (
        existingCity === city &&
        (!existingCountry || !country || existingCountry === country) &&
        (!existingRegion || !region || existingRegion === region)
      );
    });
  });
}

export default function TowingLocationCombobox({
  value,
  onChange,
  onSelect,
  biasLat,
  biasLng,
  placeholder = "Scrie localitatea",
  required = false,
  className,
}: TowingLocationComboboxProps) {
  const listboxId = useId();
  const requestControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedValueRef = useRef<string | null>(null);
  const [remoteSuggestions, setRemoteSuggestions] = useState<
    TowingLocationSuggestion[]
  >([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const localSuggestions = getLocalSuggestions(value);
  const suggestions = combineSuggestions(
    localSuggestions,
    remoteSuggestions,
  );

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setRemoteSuggestions([]);

    const text = value.trim();
    if (selectedValueRef.current === value) {
      selectedValueRef.current = null;
      return;
    }
    if (text.length < 3) {
      return;
    }

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      requestControllerRef.current = controller;

      try {
        const hasValidBias =
          typeof biasLat === "number" &&
          Number.isFinite(biasLat) &&
          typeof biasLng === "number" &&
          Number.isFinite(biasLng);
        const response = await fetch("/api/geocoding/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            ...(hasValidBias ? { lat: biasLat, lng: biasLng } : {}),
          }),
          signal: controller.signal,
        });

        if (!response.ok) return;
        const result = (await response.json()) as AutocompleteResponse;
        if (requestControllerRef.current !== controller) return;
        setRemoteSuggestions(
          Array.isArray(result.suggestions) ? result.suggestions : [],
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
      }
    }, 350);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [biasLat, biasLng, value]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [value]);

  function selectSuggestion(suggestion: TowingLocationSuggestion) {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    setRemoteSuggestions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    selectedValueRef.current = suggestion.city;
    onChange(suggestion.city);
    onSelect?.(suggestion);
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
      setActiveIndex((current) =>
        current < suggestions.length - 1 ? current + 1 : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) =>
        current > 0 ? current - 1 : suggestions.length - 1,
      );
    } else if (event.key === "Enter" && isOpen && activeIndex >= 0) {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) selectSuggestion(suggestion);
    }
  }

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
        aria-label="Oraș / Localitate"
        aria-autocomplete="list"
        aria-expanded={isOpen && suggestions.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={
          isOpen && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
      />

      {isOpen && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute inset-x-0 top-full z-[1100] mt-1 max-h-64 overflow-y-auto rounded-2xl border border-white/15 bg-neutral-950 p-1 shadow-2xl shadow-black/50"
        >
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
              className={`flex min-h-11 w-full flex-col justify-center rounded-xl px-3 py-2 text-left transition ${
                activeIndex === index
                  ? "bg-orange-500/15 text-orange-200"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <span className="text-sm font-semibold">{suggestion.city}</span>
              {(suggestion.region || suggestion.country) && (
                <span className="mt-0.5 text-xs text-white/50">
                  {[suggestion.region, suggestion.country]
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
