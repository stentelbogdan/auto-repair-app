"use client";

import dynamic from "next/dynamic";
import { CheckCircle2, MapPin, XCircle } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import AppointmentDateTimePicker, {
  toLocalDateValue,
} from "@/app/components/AppointmentDateTimePicker";
import TowingLocationCombobox from "@/app/components/towing/TowingLocationCombobox";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import type { TowingScheduleType } from "@/lib/supabase/repair-requests";
import {
  formatTowingRouteDistance,
  formatTowingRouteDuration,
} from "@/lib/towing/towing-display";
import {
  getTowingRequestedDateTime,
} from "@/lib/towing/towing-schedule-display";
import {
  type TowingReason,
  type TowingServiceDetailsV1,
  type TowingWheelState,
} from "@/lib/towing/towing-service-details";
import {
  isValidTowingRoutePaths,
  type TowingRoutePaths,
} from "@/lib/towing/towing-route";
import {
  formatLicensePlateInput,
  getLicensePlateError,
  isValidLicensePlate,
} from "@/lib/utils/licensePlate";

const TowingLocationMap = dynamic(
  () => import("@/app/components/towing/TowingLocationMap"),
  { ssr: false },
);
const TowingRouteMap = dynamic(
  () => import("@/app/components/towing/TowingRouteMap"),
  { ssr: false },
);

export type TowingCoordinates = { lat: number; lng: number };
export type TowingRouteSnapshot = {
  distanceMeters: number;
  durationSeconds: number;
  paths: TowingRoutePaths;
};

export type TowingRequestFormValues = {
  carBrand: string;
  carModel: string;
  carYear: string;
  licensePlate: string;
  pickupAddress: string;
  pickupCity: string;
  destinationAddress: string;
  destinationCity: string;
  pickupCoordinates: TowingCoordinates | null;
  destinationCoordinates: TowingCoordinates | null;
  route: TowingRouteSnapshot | null;
  scheduleType: TowingScheduleType;
  requestedDate: string;
  requestedTime: string;
  requestedTimezone: string | null;
  reason: TowingReason | "";
  starts: boolean | null;
  canBePushed: boolean | null;
  wheels: TowingWheelState | "";
};

export type TowingRequestFormInitialValues = TowingRequestFormValues;

export type ValidatedTowingRequestValues = {
  carBrand: string;
  carModel: string;
  carYear: string;
  licensePlate: string;
  city: string;
  serviceDetails: TowingServiceDetailsV1;
  pickupCoordinates: TowingCoordinates | null;
  destinationCoordinates: TowingCoordinates | null;
  route: TowingRouteSnapshot | null;
  scheduleType: TowingScheduleType;
  requestedAt: string | null;
  requestedTimezone: string | null;
};

type ValidationResult =
  | { valid: false; message: string }
  | { valid: true; values: ValidatedTowingRequestValues };

type LocationFeedback = { type: "success" | "error"; message: string };
type RouteStatus = "idle" | "loading" | "success" | "error";
type RouteResponse = {
  route: TowingRouteSnapshot & { distanceKm: number; durationMinutes: number };
};

const emptyValues: TowingRequestFormValues = {
  carBrand: "",
  carModel: "",
  carYear: "",
  licensePlate: "",
  pickupAddress: "",
  pickupCity: "",
  destinationAddress: "",
  destinationCity: "",
  pickupCoordinates: null,
  destinationCoordinates: null,
  route: null,
  scheduleType: "asap",
  requestedDate: "",
  requestedTime: "",
  requestedTimezone: null,
  reason: "",
  starts: null,
  canBePushed: null,
  wheels: "",
};

const reasonOptions: Array<{ value: TowingReason; label: string }> = [
  { value: "breakdown", label: "Defecțiune" },
  { value: "accident", label: "Accident" },
  { value: "flat_tire", label: "Pană" },
  { value: "other", label: "Altul" },
];
const wheelOptions: Array<{ value: TowingWheelState; label: string }> = [
  { value: "free", label: "Libere" },
  { value: "blocked", label: "Blocate" },
  { value: "unknown", label: "Nu știu" },
];

function isFiniteCoordinate(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Number.isFinite(value) && value >= minimum && value <= maximum;
}

function getCoordinatesKey(
  pickup: TowingCoordinates | null,
  destination: TowingCoordinates | null,
) {
  return pickup && destination
    ? `${pickup.lat},${pickup.lng}|${destination.lat},${destination.lng}`
    : null;
}

function getBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone?.trim() || null;
  } catch {
    return null;
  }
}

function getZonedDateTimeIso(date: string, time: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !timeMatch) return null;

  const [, yearText, monthText, dayText] = match;
  const [, hourText, minuteText] = timeMatch;
  const targetUtc = Date.UTC(
    Number(yearText),
    Number(monthText) - 1,
    Number(dayText),
    Number(hourText),
    Number(minuteText),
  );
  let instant = targetUtc;

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });

    for (let iteration = 0; iteration < 2; iteration += 1) {
      const parts = new Map(
        formatter
          .formatToParts(new Date(instant))
          .map((part) => [part.type, part.value]),
      );
      const displayedUtc = Date.UTC(
        Number(parts.get("year")),
        Number(parts.get("month")) - 1,
        Number(parts.get("day")),
        Number(parts.get("hour")),
        Number(parts.get("minute")),
        Number(parts.get("second")),
      );
      instant -= displayedUtc - targetUtc;
    }

    const requested = getTowingRequestedDateTime(
      "scheduled",
      new Date(instant).toISOString(),
      timezone,
    );
    return requested?.date === date && requested.time === time
      ? new Date(instant).toISOString()
      : null;
  } catch {
    return null;
  }
}

export function validateTowingRequestFormValues(
  values: TowingRequestFormValues,
): ValidationResult {
  if (!values.carBrand) return { valid: false, message: "Selectează marca mașinii." };
  if (!values.carModel) return { valid: false, message: "Selectează modelul mașinii." };
  if (!values.carYear) return { valid: false, message: "Selectează anul fabricației." };
  if (!isValidLicensePlate(values.licensePlate)) {
    return { valid: false, message: "Introdu un număr de înmatriculare valid." };
  }

  const pickupAddress = values.pickupAddress.trim();
  const pickupCity = values.pickupCity.trim();
  const destinationAddress = values.destinationAddress.trim();
  const destinationCity = values.destinationCity.trim();
  if (!pickupAddress) return { valid: false, message: "Introdu adresa de preluare." };
  if (!pickupCity) return { valid: false, message: "Selectează orașul de preluare." };
  if (!destinationAddress) return { valid: false, message: "Introdu adresa destinației." };
  if (!destinationCity) return { valid: false, message: "Selectează orașul destinației." };
  if (!values.reason) return { valid: false, message: "Selectează motivul tractării." };
  if (values.starts === null) return { valid: false, message: "Spune dacă mașina pornește." };
  if (values.canBePushed === null) return { valid: false, message: "Spune dacă mașina poate fi împinsă." };
  if (!values.wheels) return { valid: false, message: "Selectează starea roților." };

  let requestedAt: string | null = null;
  let requestedTimezone: string | null = null;
  if (values.scheduleType === "scheduled") {
    if (!values.requestedDate) return { valid: false, message: "Alege data tractării." };
    if (!values.requestedTime) return { valid: false, message: "Alege ora tractării." };
    requestedTimezone = values.requestedTimezone?.trim() || getBrowserTimezone();
    if (!requestedTimezone) {
      return { valid: false, message: "Nu am putut determina fusul orar. Reîncearcă." };
    }
    requestedAt = getZonedDateTimeIso(
      values.requestedDate,
      values.requestedTime,
      requestedTimezone,
    );
    if (!requestedAt) return { valid: false, message: "Alege o dată și o oră valide." };
    if (new Date(requestedAt).getTime() <= Date.now()) {
      return { valid: false, message: "Data și ora selectate nu pot fi în trecut." };
    }
  }

  return {
    valid: true,
    values: {
      carBrand: values.carBrand,
      carModel: values.carModel,
      carYear: values.carYear,
      licensePlate: values.licensePlate,
      city: pickupCity,
      serviceDetails: {
        version: 1,
        kind: "towing",
        pickup: { address: pickupAddress, city: pickupCity },
        destination: { address: destinationAddress, city: destinationCity },
        reason: values.reason,
        vehicleCondition: {
          starts: values.starts,
          canBePushed: values.canBePushed,
          wheels: values.wheels,
        },
      },
      pickupCoordinates: values.pickupCoordinates,
      destinationCoordinates: values.destinationCoordinates,
      route: values.route,
      scheduleType: values.scheduleType,
      requestedAt,
      requestedTimezone,
    },
  };
}

type TowingRequestFormProps = {
  initialValues?: TowingRequestFormInitialValues;
  onValuesChange: (values: TowingRequestFormValues) => void;
};

export default function TowingRequestForm({
  initialValues,
  onValuesChange,
}: TowingRequestFormProps) {
  const [values, setValues] = useState<TowingRequestFormValues>(
    () => initialValues ?? emptyValues,
  );
  const [pickupFeedback, setPickupFeedback] = useState<LocationFeedback | null>(null);
  const [destinationFeedback, setDestinationFeedback] = useState<LocationFeedback | null>(null);
  const [isLocatingPickup, setIsLocatingPickup] = useState(false);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>(
    () => (initialValues?.route ? "success" : "idle"),
  );
  const [scheduleDateInput, setScheduleDateInput] = useState(
    () => initialValues?.requestedDate.split("-").reverse().join(".") ?? "",
  );
  const [scheduleDateError, setScheduleDateError] = useState("");
  const pickupController = useRef<AbortController | null>(null);
  const destinationController = useRef<AbortController | null>(null);
  const pickupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const destinationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routingController = useRef<AbortController | null>(null);
  const routingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preserveInitialRouteRef = useRef(
    Boolean(
      initialValues?.route &&
        initialValues.pickupCoordinates &&
        initialValues.destinationCoordinates,
    ),
  );
  const availableModels = carModelsByBrand[values.carBrand] || [];
  const years = Array.from(
    { length: new Date().getFullYear() - 1989 },
    (_, index) => String(new Date().getFullYear() - index),
  );
  const coordinatesKey = getCoordinatesKey(
    values.pickupCoordinates,
    values.destinationCoordinates,
  );
  const plateHasError =
    values.licensePlate.length > 0 && !isValidLicensePlate(values.licensePlate);
  const scheduleMinDate =
    (values.requestedTimezone
      ? getTowingRequestedDateTime(
          "scheduled",
          new Date().toISOString(),
          values.requestedTimezone,
        )?.date
      : null) ?? toLocalDateValue(new Date());

  useEffect(() => onValuesChange(values), [onValuesChange, values]);

  useEffect(() => {
    const pickupControllerRef = pickupController;
    const destinationControllerRef = destinationController;
    const routingControllerRef = routingController;
    const pickupTimerRef = pickupTimer;
    const destinationTimerRef = destinationTimer;
    const routingTimerRef = routingTimer;

    return () => {
      pickupControllerRef.current?.abort();
      destinationControllerRef.current?.abort();
      routingControllerRef.current?.abort();
      if (pickupTimerRef.current) clearTimeout(pickupTimerRef.current);
      if (destinationTimerRef.current) clearTimeout(destinationTimerRef.current);
      if (routingTimerRef.current) clearTimeout(routingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (routingTimer.current) clearTimeout(routingTimer.current);
    routingController.current?.abort();

    if (preserveInitialRouteRef.current) {
      preserveInitialRouteRef.current = false;
      setRouteStatus("success");
      return;
    }

    if (!coordinatesKey) {
      setRouteStatus("idle");
      setValues((current) =>
        current.route ? { ...current, route: null } : current,
      );
      return;
    }

    const [pickupKey, destinationKey] = coordinatesKey.split("|");
    const [pickupLat, pickupLng] = pickupKey.split(",").map(Number);
    const [destinationLat, destinationLng] = destinationKey
      .split(",")
      .map(Number);

    setRouteStatus("loading");
    setValues((current) => ({ ...current, route: null }));
    routingTimer.current = setTimeout(async () => {
      const controller = new AbortController();
      routingController.current = controller;
      try {
        const response = await fetch("/api/routing/towing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickupLat,
            pickupLng,
            destinationLat,
            destinationLng,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Routing failed.");
        const result = (await response.json()) as RouteResponse;
        if (routingController.current !== controller) return;
        const route = result.route;
        if (
          !route ||
          !Number.isFinite(route.distanceMeters) ||
          route.distanceMeters < 0 ||
          !Number.isFinite(route.durationSeconds) ||
          route.durationSeconds < 0 ||
          !isValidTowingRoutePaths(route.paths)
        ) {
          throw new Error("Invalid route.");
        }
        setValues((current) =>
          getCoordinatesKey(
            current.pickupCoordinates,
            current.destinationCoordinates,
          ) === coordinatesKey
            ? {
                ...current,
                route: {
                  distanceMeters: route.distanceMeters,
                  durationSeconds: route.durationSeconds,
                  paths: route.paths,
                },
              }
            : current,
        );
        setRouteStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (routingController.current !== controller) return;
        setRouteStatus("error");
      } finally {
        if (routingController.current === controller) {
          routingController.current = null;
        }
      }
    }, 700);

    return () => {
      if (routingTimer.current) clearTimeout(routingTimer.current);
      routingController.current?.abort();
    };
  }, [coordinatesKey]);

  function update(patch: Partial<TowingRequestFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
  }

  async function reverseGeocode(
    kind: "pickup" | "destination",
    coordinates: TowingCoordinates,
    source: "gps" | "drag",
  ) {
    const ref = kind === "pickup" ? pickupController : destinationController;
    ref.current?.abort();
    const controller = new AbortController();
    ref.current = controller;
    try {
      const response = await fetch("/api/geocoding/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coordinates),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Reverse geocoding failed.");
      const result = (await response.json()) as {
        address: string | null;
        city: string | null;
      };
      if (ref.current !== controller) return;
      const address = result.address?.trim() || "";
      const city = result.city?.trim() || "";
      if (!address || !city) throw new Error("Incomplete location.");
      update(
        kind === "pickup"
          ? { pickupAddress: address, pickupCity: city, pickupCoordinates: coordinates }
          : {
              destinationAddress: address,
              destinationCity: city,
              destinationCoordinates: coordinates,
            },
      );
      const feedback = {
        type: "success" as const,
        message: source === "drag" ? "Poziție ajustată pe hartă" : "Locație detectată",
      };
      if (kind === "pickup") setPickupFeedback(feedback);
      else setDestinationFeedback(feedback);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (ref.current !== controller) return;
      update(kind === "pickup" ? { pickupCoordinates: null } : { destinationCoordinates: null });
      const feedback = {
        type: "error" as const,
        message: "Locația nu a putut fi completată automat. Introdu adresa manual.",
      };
      if (kind === "pickup") setPickupFeedback(feedback);
      else setDestinationFeedback(feedback);
    } finally {
      if (ref.current === controller) ref.current = null;
      if (source === "gps") setIsLocatingPickup(false);
    }
  }

  async function forwardGeocode(
    kind: "pickup" | "destination",
    address: string,
    city: string,
    bias: TowingCoordinates | null,
  ) {
    const ref = kind === "pickup" ? pickupController : destinationController;
    ref.current?.abort();
    const controller = new AbortController();
    ref.current = controller;
    try {
      const response = await fetch("/api/geocoding/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          ...(bias ? { lat: bias.lat, lng: bias.lng } : {}),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Forward geocoding failed.");
      const result = (await response.json()) as {
        lat: number | null;
        lng: number | null;
        matched: boolean;
      };
      if (ref.current !== controller) return;
      if (
        !result.matched ||
        typeof result.lat !== "number" ||
        typeof result.lng !== "number" ||
        !isFiniteCoordinate(result.lat, -90, 90) ||
        !isFiniteCoordinate(result.lng, -180, 180)
      ) {
        throw new Error("Address not matched.");
      }
      const coordinates = { lat: result.lat, lng: result.lng };
      update(kind === "pickup" ? { pickupCoordinates: coordinates } : { destinationCoordinates: coordinates });
      const feedback = { type: "success" as const, message: "Pin actualizat după adresă" };
      if (kind === "pickup") setPickupFeedback(feedback);
      else setDestinationFeedback(feedback);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (ref.current !== controller) return;
      const feedback = { type: "error" as const, message: "Adresa nu a putut fi localizată exact." };
      if (kind === "pickup") setPickupFeedback(feedback);
      else setDestinationFeedback(feedback);
    } finally {
      if (ref.current === controller) ref.current = null;
    }
  }

  function changeLocationText(
    kind: "pickup" | "destination",
    field: "address" | "city",
    value: string,
  ) {
    const previousCoordinates =
      kind === "pickup"
        ? values.pickupCoordinates
        : values.destinationCoordinates;
    if (kind === "pickup") {
      pickupController.current?.abort();
      pickupController.current = null;
    } else {
      destinationController.current?.abort();
      destinationController.current = null;
    }
    const address = field === "address"
      ? value
      : kind === "pickup"
        ? values.pickupAddress
        : values.destinationAddress;
    const city = field === "city"
      ? value
      : kind === "pickup"
        ? values.pickupCity
        : values.destinationCity;
    update(
      kind === "pickup"
        ? {
            [field === "address" ? "pickupAddress" : "pickupCity"]: value,
            pickupCoordinates: null,
            route: null,
          }
        : {
            [field === "address" ? "destinationAddress" : "destinationCity"]: value,
            destinationCoordinates: null,
            route: null,
          },
    );
    const timer = kind === "pickup" ? pickupTimer : destinationTimer;
    if (timer.current) clearTimeout(timer.current);
    if (!address.trim() || !city.trim()) return;
    timer.current = setTimeout(() => {
      void forwardGeocode(
        kind,
        address.trim(),
        city.trim(),
        previousCoordinates,
      );
    }, 900);
  }

  function detectPickupLocation() {
    if (!navigator.geolocation) {
      setPickupFeedback({ type: "error", message: "Localizarea nu este disponibilă." });
      return;
    }
    setIsLocatingPickup(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void reverseGeocode(
          "pickup",
          { lat: position.coords.latitude, lng: position.coords.longitude },
          "gps",
        );
      },
      () => {
        setIsLocatingPickup(false);
        setPickupFeedback({ type: "error", message: "Locația nu a putut fi detectată." });
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  }

  return (
    <div>
      <section className="rounded-3xl bg-white p-5 text-black shadow-2xl shadow-black/20 md:p-6">
        <h2 className="text-lg font-black">Vehicul</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <FieldLabel label="Marca mașinii">
            <select
              value={values.carBrand}
              onChange={(event) => update({ carBrand: event.target.value, carModel: "" })}
              className={lightInputClassName}
            >
              <option value="">Alege marca</option>
              {carBrands.map((brand) => <option key={brand}>{brand}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label="Model">
            <select
              value={values.carModel}
              onChange={(event) => update({ carModel: event.target.value })}
              disabled={!values.carBrand}
              className={`${lightInputClassName} disabled:opacity-50`}
            >
              <option value="">{values.carBrand ? "Alege modelul" : "Alege întâi marca"}</option>
              {availableModels.map((model) => <option key={model}>{model}</option>)}
              <option value="Alt model">Alt model</option>
            </select>
          </FieldLabel>
          <FieldLabel label="An fabricație">
            <select
              value={values.carYear}
              onChange={(event) => update({ carYear: event.target.value })}
              className={lightInputClassName}
            >
              <option value="">Alege anul</option>
              {years.map((year) => <option key={year}>{year}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel label="Număr înmatriculare">
            <div className="relative">
              <input
                value={values.licensePlate}
                onChange={(event) => update({ licensePlate: formatLicensePlateInput(event.target.value) })}
                className={`w-full rounded-2xl border bg-black/[0.03] px-4 py-3 pr-14 outline-none ${plateHasError ? "border-red-500" : values.licensePlate ? "border-emerald-500" : "border-black/10"}`}
                maxLength={11}
              />
              {values.licensePlate && (plateHasError ? <XCircle className="absolute right-4 top-1/2 -translate-y-1/2 text-red-500" /> : <CheckCircle2 className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500" />)}
            </div>
            {plateHasError && <p className="mt-2 text-sm text-red-600">{getLicensePlateError(values.licensePlate)}</p>}
          </FieldLabel>
        </div>
      </section>

      <LocationSection
        title="Locație preluare"
        address={values.pickupAddress}
        city={values.pickupCity}
        addressPlaceholder="Stradă, număr, reper"
        onAddressChange={(value) => changeLocationText("pickup", "address", value)}
        onCityChange={(value) => changeLocationText("pickup", "city", value)}
        coordinates={values.pickupCoordinates}
        onPositionChange={(lat, lng) => void reverseGeocode("pickup", { lat, lng }, "drag")}
        showAttribution
        action={
          <>
            <button type="button" onClick={detectPickupLocation} disabled={isLocatingPickup} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-orange-400/60 bg-orange-500/10 px-4 py-3 text-sm font-bold text-orange-300 disabled:opacity-60">
              <MapPin size={18} />{isLocatingPickup ? "Se caută locația..." : "Folosește locația mea"}
            </button>
            <LocationFeedbackView feedback={pickupFeedback} />
          </>
        }
      />
      <LocationSection
        title="Destinație"
        address={values.destinationAddress}
        city={values.destinationCity}
        addressPlaceholder="Adresa unde va fi transportată mașina"
        onAddressChange={(value) => changeLocationText("destination", "address", value)}
        onCityChange={(value) => changeLocationText("destination", "city", value)}
        coordinates={values.destinationCoordinates}
        onPositionChange={(lat, lng) => void reverseGeocode("destination", { lat, lng }, "drag")}
        action={<LocationFeedbackView feedback={destinationFeedback} />}
      />

      {values.pickupCoordinates && values.destinationCoordinates && (
        <section className={darkSectionClassName}>
          <h2 className="text-base font-black">Traseu estimat</h2>
          {routeStatus === "success" && values.route ? (
            <>
              <p className="mt-2 text-lg font-bold text-orange-300">{formatTowingRouteDistance(values.route.distanceMeters)} · {formatTowingRouteDuration(values.route.durationSeconds)}</p>
              <TowingRouteMap pickup={values.pickupCoordinates} destination={values.destinationCoordinates} paths={values.route.paths} />
            </>
          ) : <p className="mt-2 text-sm text-white/55">{routeStatus === "error" ? "Traseul nu este disponibil momentan." : "Se calculează traseul..."}</p>}
        </section>
      )}

      <section className={darkSectionClassName}>
        <h2 className="text-base font-black">Când ai nevoie de tractare?</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <ChoiceButton
            selected={values.scheduleType === "asap"}
            onClick={() => {
              update({
                scheduleType: "asap",
                requestedDate: "",
                requestedTime: "",
                requestedTimezone: null,
              });
              setScheduleDateInput("");
              setScheduleDateError("");
            }}
          >
            Cât mai repede
          </ChoiceButton>
          <ChoiceButton selected={values.scheduleType === "scheduled"} onClick={() => update({ scheduleType: "scheduled", requestedTimezone: values.requestedTimezone || getBrowserTimezone() })}>Alege data și ora</ChoiceButton>
        </div>
        {values.scheduleType === "scheduled" && (
          <div className="mt-4">
            <AppointmentDateTimePicker
              date={values.requestedDate}
              dateInput={scheduleDateInput}
              dateError={scheduleDateError}
              time={values.requestedTime}
              timeSelectionMode="wheel"
              minDate={scheduleMinDate}
              onDateChange={(requestedDate) => update({ requestedDate })}
              onDateInputChange={setScheduleDateInput}
              onDateErrorChange={setScheduleDateError}
              onTimeChange={(requestedTime) => update({ requestedTime })}
            />
          </div>
        )}
      </section>

      <section className={darkSectionClassName}>
        <h2 className="text-base font-black">Motiv tractare</h2>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {reasonOptions.map((option) => <ChoiceButton key={option.value} selected={values.reason === option.value} onClick={() => update({ reason: option.value })}>{option.label}</ChoiceButton>)}
        </div>
      </section>
      <section className={darkSectionClassName}>
        <h2 className="text-base font-black">Stare vehicul</h2>
        <div className="mt-4 space-y-4">
          <BinaryQuestion label="Mașina pornește?" value={values.starts} onChange={(starts) => update({ starts })} />
          <BinaryQuestion label="Poate fi împinsă?" value={values.canBePushed} onChange={(canBePushed) => update({ canBePushed })} />
          <div>
            <p className="text-sm font-semibold text-white/75">Starea roților</p>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {wheelOptions.map((option) => <ChoiceButton key={option.value} selected={values.wheels === option.value} onClick={() => update({ wheels: option.value })}>{option.label}</ChoiceButton>)}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const lightInputClassName = "w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400";
const darkInputClassName = "w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-orange-400";
const darkSectionClassName = "mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4 text-white";

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return <label><span className="mb-2 block text-sm font-medium text-black/70">{label}</span>{children}</label>;
}

function LocationFeedbackView({ feedback }: { feedback: LocationFeedback | null }) {
  return feedback ? <p className={`mt-2 text-sm font-medium ${feedback.type === "success" ? "text-emerald-400" : "text-red-400"}`}>{feedback.message}</p> : null;
}

function LocationSection({ title, address, city, addressPlaceholder, onAddressChange, onCityChange, coordinates, onPositionChange, action, showAttribution = false }: {
  title: string;
  address: string;
  city: string;
  addressPlaceholder: string;
  onAddressChange: (value: string) => void;
  onCityChange: (value: string) => void;
  coordinates: TowingCoordinates | null;
  onPositionChange: (lat: number, lng: number) => void;
  action: ReactNode;
  showAttribution?: boolean;
}) {
  return <section className={darkSectionClassName}>
    <h2 className="text-base font-black">{title}</h2>{action}
    <div className="mt-3 grid gap-3 md:grid-cols-2">
      <label><span className="mb-2 block text-sm font-medium text-white/70">Adresă</span><input value={address} onChange={(event) => onAddressChange(event.target.value)} placeholder={addressPlaceholder} className={darkInputClassName} /></label>
      <div><span className="mb-2 block text-sm font-medium text-white/70">Oraș</span><TowingLocationCombobox value={city} onChange={onCityChange} biasLat={coordinates?.lat} biasLng={coordinates?.lng} placeholder="Scrie localitatea" className={darkInputClassName} required /></div>
    </div>
    {showAttribution ? (
      <p className="mt-2 text-xs text-white/45">
        Date geocodare: <a className="underline underline-offset-2" href="https://www.geoapify.com/" rel="noreferrer" target="_blank">Geoapify</a>{" "}
        · <a className="underline underline-offset-2" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">© OpenStreetMap contributors</a>
      </p>
    ) : null}
    {coordinates && <TowingLocationMap lat={coordinates.lat} lng={coordinates.lng} onPositionChange={onPositionChange} />}
  </section>;
}

function ChoiceButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition ${selected ? "border-orange-400 bg-orange-500 text-black" : "border-white/10 bg-black/30 text-white/75"}`}>{children}</button>;
}

function BinaryQuestion({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean) => void }) {
  return <div><p className="text-sm font-semibold text-white/75">{label}</p><div className="mt-2 grid grid-cols-2 gap-2"><ChoiceButton selected={value === true} onClick={() => onChange(true)}>Da</ChoiceButton><ChoiceButton selected={value === false} onClick={() => onChange(false)}>Nu</ChoiceButton></div></div>;
}
