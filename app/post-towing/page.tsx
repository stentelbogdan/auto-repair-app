"use client";

import {
  Suspense,
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, MapPin, XCircle } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import ImageGallery from "@/app/components/ImageGallery";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import { romaniaCities } from "@/lib/data/romania-cities";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { supabase } from "@/lib/supabase/client";
import {
  type TowingReason,
  type TowingServiceDetailsV1,
  type TowingWheelState,
} from "@/lib/towing/towing-service-details";
import {
  formatLicensePlateInput,
  getLicensePlateError,
  isValidLicensePlate,
} from "@/lib/utils/licensePlate";

const TowingLocationMap = dynamic(
  () => import("@/app/components/towing/TowingLocationMap"),
  { ssr: false },
);

type StoredImage = {
  name: string;
  url?: string;
  dataUrl?: string;
};

type TowingDraft = {
  carBrand: string;
  carModel: string;
  carYear: string;
  licensePlate: string;
  pickupAddress: string;
  pickupCity: string;
  destinationAddress: string;
  destinationCity: string;
  reason: TowingReason | "";
  starts: boolean | null;
  canBePushed: boolean | null;
  wheels: TowingWheelState | "";
  description: string;
};

type PickupCoordinates = {
  lat: number;
  lng: number;
  accuracy?: number;
};

type DestinationCoordinates = {
  lat: number;
  lng: number;
};

type LocationFeedback = {
  type: "success" | "error";
  message: string;
};

type ReverseGeocodingResult = {
  address: string | null;
  city: string | null;
};

type ForwardGeocodingResult = {
  lat: number | null;
  lng: number | null;
  matched: boolean;
};

type ReverseGeocodingSource = "gps" | "drag";

type ValidationResult =
  | { valid: false; message: string }
  | { valid: true; serviceDetails: TowingServiceDetailsV1 };

const initialDraft: TowingDraft = {
  carBrand: "",
  carModel: "",
  carYear: "",
  licensePlate: "",
  pickupAddress: "",
  pickupCity: "",
  destinationAddress: "",
  destinationCity: "",
  reason: "",
  starts: null,
  canBePushed: null,
  wheels: "",
  description: "",
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

async function uploadRepairImage(
  preparedImage: PreparedImage,
  originalName: string,
  userId: string,
): Promise<StoredImage> {
  const fileName = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${preparedImage.extension}`;

  const { error } = await supabase.storage
    .from("repair-images")
    .upload(fileName, preparedImage.file, {
      contentType: preparedImage.contentType,
    });

  if (error) throw error;

  const { data } = supabase.storage
    .from("repair-images")
    .getPublicUrl(fileName);

  return { name: originalName, url: data.publicUrl };
}

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}`,
  );
}

function validateDraft(draft: TowingDraft): ValidationResult {
  if (!draft.carBrand) {
    return { valid: false, message: "Selectează marca mașinii." };
  }
  if (!draft.carModel) {
    return { valid: false, message: "Selectează modelul mașinii." };
  }
  if (!draft.carYear) {
    return { valid: false, message: "Selectează anul fabricației." };
  }
  if (!isValidLicensePlate(draft.licensePlate)) {
    return {
      valid: false,
      message: "Introdu un număr de înmatriculare valid.",
    };
  }

  const pickupAddress = draft.pickupAddress.trim();
  const pickupCity = draft.pickupCity.trim();
  const destinationAddress = draft.destinationAddress.trim();
  const destinationCity = draft.destinationCity.trim();

  if (!pickupAddress) {
    return { valid: false, message: "Introdu adresa de preluare." };
  }
  if (!pickupCity) {
    return { valid: false, message: "Selectează orașul de preluare." };
  }
  if (!destinationAddress) {
    return { valid: false, message: "Introdu adresa destinației." };
  }
  if (!destinationCity) {
    return { valid: false, message: "Selectează orașul destinației." };
  }
  if (!draft.reason) {
    return { valid: false, message: "Selectează motivul tractării." };
  }
  if (draft.starts === null) {
    return { valid: false, message: "Spune dacă mașina pornește." };
  }
  if (draft.canBePushed === null) {
    return { valid: false, message: "Spune dacă mașina poate fi împinsă." };
  }
  if (!draft.wheels) {
    return { valid: false, message: "Selectează starea roților." };
  }

  return {
    valid: true,
    serviceDetails: {
      version: 1,
      kind: "towing",
      pickup: { address: pickupAddress, city: pickupCity },
      destination: { address: destinationAddress, city: destinationCity },
      reason: draft.reason,
      vehicleCondition: {
        starts: draft.starts,
        canBePushed: draft.canBePushed,
        wheels: draft.wheels,
      },
    },
  };
}

export default function PostTowingPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
          <p className="text-sm text-white/65">Se încarcă...</p>
        </main>
      }
    >
      <PostTowingContent />
    </Suspense>
  );
}

function PostTowingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetWorkshopId = searchParams.get("targetWorkshopId");
  const [draft, setDraft] = useState<TowingDraft>(initialDraft);
  const [files, setFiles] = useState<File[]>([]);
  const [pickupCoordinates, setPickupCoordinates] =
    useState<PickupCoordinates | null>(null);
  const [destinationCoordinates, setDestinationCoordinates] =
    useState<DestinationCoordinates | null>(null);
  const [isLocatingPickup, setIsLocatingPickup] = useState(false);
  const [pickupLocationFeedback, setPickupLocationFeedback] =
    useState<LocationFeedback | null>(null);
  const [destinationLocationFeedback, setDestinationLocationFeedback] =
    useState<LocationFeedback | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const geocodingControllerRef = useRef<AbortController | null>(null);
  const forwardGeocodingTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const destinationGeocodingControllerRef =
    useRef<AbortController | null>(null);
  const destinationForwardGeocodingTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const availableModels = carModelsByBrand[draft.carBrand] || [];
  const years = Array.from(
    { length: new Date().getFullYear() - 1989 },
    (_, index) => String(new Date().getFullYear() - index),
  );
  const previewUrls = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );
  const licensePlateHasError =
    draft.licensePlate.length > 0 &&
    !isValidLicensePlate(draft.licensePlate);
  const licensePlateErrorMessage = getLicensePlateError(draft.licensePlate);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      geocodingControllerRef.current?.abort();
      if (forwardGeocodingTimerRef.current) {
        clearTimeout(forwardGeocodingTimerRef.current);
      }
      destinationGeocodingControllerRef.current?.abort();
      if (destinationForwardGeocodingTimerRef.current) {
        clearTimeout(destinationForwardGeocodingTimerRef.current);
      }
    };
  }, []);

  function updateDraft(patch: Partial<TowingDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const newFiles = Array.from(event.target.files || []);

    if (newFiles.length === 0) return;

    setFiles((currentFiles) =>
      [...currentFiles, ...newFiles].slice(0, 8),
    );
    event.currentTarget.value = "";
  }

  function removeFile(index: number) {
    setFiles((currentFiles) =>
      currentFiles.filter((_, currentIndex) => currentIndex !== index),
    );
  }

  async function reverseGeocodePickup(
    coordinates: PickupCoordinates,
    source: ReverseGeocodingSource,
  ) {
    if (forwardGeocodingTimerRef.current) {
      clearTimeout(forwardGeocodingTimerRef.current);
      forwardGeocodingTimerRef.current = null;
    }
    geocodingControllerRef.current?.abort();
    const controller = new AbortController();
    geocodingControllerRef.current = controller;

    setPickupLocationFeedback({
      type: "success",
      message:
        source === "drag"
          ? "Se actualizează adresa..."
          : "Se identifică adresa...",
    });

    try {
      const response = await fetch("/api/geocoding/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: coordinates.lat,
          lng: coordinates.lng,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Reverse geocoding failed.");

      const result = (await response.json()) as ReverseGeocodingResult;
      if (geocodingControllerRef.current !== controller) return;

      const pickupAddress = result.address?.trim() || "";
      const pickupCity = result.city?.trim() || "";
      updateDraft({ pickupAddress, pickupCity });

      if (!pickupAddress || !pickupCity) {
        throw new Error("Incomplete reverse geocoding result.");
      }

      setPickupLocationFeedback({
        type: "success",
        message:
          source === "drag"
            ? "Poziție ajustată pe hartă"
            : coordinates.accuracy
              ? `Locație detectată · Precizie ~${Math.round(coordinates.accuracy)} m`
              : "Locație detectată",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (geocodingControllerRef.current !== controller) return;

      if (source === "drag") {
        updateDraft({ pickupAddress: "", pickupCity: "" });
      }
      setPickupLocationFeedback({
        type: "error",
        message:
          source === "drag"
            ? "Poziția a fost actualizată. Introdu adresa manual."
            : "Locația a fost detectată, dar adresa nu a putut fi completată automat. Introdu adresa manual.",
      });
    } finally {
      if (geocodingControllerRef.current === controller) {
        geocodingControllerRef.current = null;
      }
      if (source === "gps") setIsLocatingPickup(false);
    }
  }

  async function forwardGeocodePickup(address: string, city: string) {
    geocodingControllerRef.current?.abort();
    const controller = new AbortController();
    geocodingControllerRef.current = controller;

    try {
      const response = await fetch("/api/geocoding/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          ...(pickupCoordinates
            ? {
                lat: pickupCoordinates.lat,
                lng: pickupCoordinates.lng,
              }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Forward geocoding failed.");

      const result = (await response.json()) as ForwardGeocodingResult;
      if (geocodingControllerRef.current !== controller) return;

      if (
        !result.matched ||
        typeof result.lat !== "number" ||
        !Number.isFinite(result.lat) ||
        typeof result.lng !== "number" ||
        !Number.isFinite(result.lng)
      ) {
        throw new Error("Address not matched.");
      }

      setPickupCoordinates({ lat: result.lat, lng: result.lng });
      setPickupLocationFeedback({
        type: "success",
        message: "Pin actualizat după adresă",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (geocodingControllerRef.current !== controller) return;

      setPickupLocationFeedback({
        type: "error",
        message: "Adresa nu a putut fi localizată exact. Verifică pinul.",
      });
    } finally {
      if (geocodingControllerRef.current === controller) {
        geocodingControllerRef.current = null;
      }
    }
  }

  function scheduleForwardGeocoding(address: string, city: string) {
    if (forwardGeocodingTimerRef.current) {
      clearTimeout(forwardGeocodingTimerRef.current);
    }
    geocodingControllerRef.current?.abort();
    geocodingControllerRef.current = null;

    const normalizedAddress = address.trim();
    const normalizedCity = city.trim();
    if (!normalizedAddress || !normalizedCity) {
      forwardGeocodingTimerRef.current = null;
      return;
    }

    forwardGeocodingTimerRef.current = setTimeout(() => {
      forwardGeocodingTimerRef.current = null;
      void forwardGeocodePickup(normalizedAddress, normalizedCity);
    }, 900);
  }

  function handlePickupAddressChange(pickupAddress: string) {
    updateDraft({ pickupAddress });
    scheduleForwardGeocoding(pickupAddress, draft.pickupCity);
  }

  function handlePickupCityChange(pickupCity: string) {
    updateDraft({ pickupCity });
    scheduleForwardGeocoding(draft.pickupAddress, pickupCity);
  }

  function handlePickupPositionChange(lat: number, lng: number) {
    const coordinates = { lat, lng };
    setPickupCoordinates(coordinates);
    void reverseGeocodePickup(coordinates, "drag");
  }

  async function reverseGeocodeDestination(
    coordinates: DestinationCoordinates,
  ) {
    if (destinationForwardGeocodingTimerRef.current) {
      clearTimeout(destinationForwardGeocodingTimerRef.current);
      destinationForwardGeocodingTimerRef.current = null;
    }
    destinationGeocodingControllerRef.current?.abort();
    const controller = new AbortController();
    destinationGeocodingControllerRef.current = controller;

    setDestinationLocationFeedback({
      type: "success",
      message: "Se actualizează adresa...",
    });

    try {
      const response = await fetch("/api/geocoding/reverse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(coordinates),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Reverse geocoding failed.");

      const result = (await response.json()) as ReverseGeocodingResult;
      if (destinationGeocodingControllerRef.current !== controller) return;

      const destinationAddress = result.address?.trim() || "";
      const destinationCity = result.city?.trim() || "";
      updateDraft({ destinationAddress, destinationCity });

      if (!destinationAddress || !destinationCity) {
        throw new Error("Incomplete reverse geocoding result.");
      }

      setDestinationLocationFeedback({
        type: "success",
        message: "Poziție ajustată pe hartă",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (destinationGeocodingControllerRef.current !== controller) return;

      updateDraft({ destinationAddress: "", destinationCity: "" });
      setDestinationLocationFeedback({
        type: "error",
        message: "Poziția a fost actualizată. Introdu adresa manual.",
      });
    } finally {
      if (destinationGeocodingControllerRef.current === controller) {
        destinationGeocodingControllerRef.current = null;
      }
    }
  }

  async function forwardGeocodeDestination(address: string, city: string) {
    destinationGeocodingControllerRef.current?.abort();
    const controller = new AbortController();
    destinationGeocodingControllerRef.current = controller;

    try {
      const response = await fetch("/api/geocoding/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          city,
          ...(destinationCoordinates
            ? {
                lat: destinationCoordinates.lat,
                lng: destinationCoordinates.lng,
              }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Forward geocoding failed.");

      const result = (await response.json()) as ForwardGeocodingResult;
      if (destinationGeocodingControllerRef.current !== controller) return;

      if (
        !result.matched ||
        typeof result.lat !== "number" ||
        !Number.isFinite(result.lat) ||
        typeof result.lng !== "number" ||
        !Number.isFinite(result.lng)
      ) {
        throw new Error("Address not matched.");
      }

      setDestinationCoordinates({ lat: result.lat, lng: result.lng });
      setDestinationLocationFeedback({
        type: "success",
        message: "Pin actualizat după adresă",
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (destinationGeocodingControllerRef.current !== controller) return;

      setDestinationLocationFeedback({
        type: "error",
        message: "Adresa nu a putut fi localizată exact. Verifică pinul.",
      });
    } finally {
      if (destinationGeocodingControllerRef.current === controller) {
        destinationGeocodingControllerRef.current = null;
      }
    }
  }

  function scheduleDestinationForwardGeocoding(
    address: string,
    city: string,
  ) {
    if (destinationForwardGeocodingTimerRef.current) {
      clearTimeout(destinationForwardGeocodingTimerRef.current);
    }
    destinationGeocodingControllerRef.current?.abort();
    destinationGeocodingControllerRef.current = null;

    const normalizedAddress = address.trim();
    const normalizedCity = city.trim();
    if (!normalizedAddress || !normalizedCity) {
      destinationForwardGeocodingTimerRef.current = null;
      return;
    }

    destinationForwardGeocodingTimerRef.current = setTimeout(() => {
      destinationForwardGeocodingTimerRef.current = null;
      void forwardGeocodeDestination(normalizedAddress, normalizedCity);
    }, 900);
  }

  function handleDestinationAddressChange(destinationAddress: string) {
    updateDraft({ destinationAddress });
    scheduleDestinationForwardGeocoding(
      destinationAddress,
      draft.destinationCity,
    );
  }

  function handleDestinationCityChange(destinationCity: string) {
    updateDraft({ destinationCity });
    scheduleDestinationForwardGeocoding(
      draft.destinationAddress,
      destinationCity,
    );
  }

  function handleDestinationPositionChange(lat: number, lng: number) {
    const coordinates = { lat, lng };
    setDestinationCoordinates(coordinates);
    void reverseGeocodeDestination(coordinates);
  }

  function detectPickupLocation() {
    if (
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      setPickupLocationFeedback({
        type: "error",
        message: "Localizarea nu este disponibilă pe acest dispozitiv.",
      });
      return;
    }

    if (isLocatingPickup) return;

    setIsLocatingPickup(true);
    setPickupLocationFeedback(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const accuracy = Number.isFinite(position.coords.accuracy)
          ? position.coords.accuracy
          : undefined;

        const coordinates = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy,
        };

        setPickupCoordinates(coordinates);
        void reverseGeocodePickup(coordinates, "gps");
      },
      (error) => {
        let message =
          "Locația nu a putut fi determinată. Introdu adresa manual.";

        if (error.code === error.PERMISSION_DENIED) {
          message =
            "Accesul la locație a fost refuzat. Poți introduce adresa manual.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          message =
            "Locația nu a putut fi determinată. Introdu adresa manual.";
        } else if (error.code === error.TIMEOUT) {
          message =
            "Localizarea a durat prea mult. Încearcă din nou sau introdu adresa manual.";
        }

        setPickupLocationFeedback({ type: "error", message });
        setIsLocatingPickup(false);
      },
      {
        enableHighAccuracy: true,
        timeout: 12_000,
        maximumAge: 0,
      },
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const validationResult = validateDraft(draft);

    if (!validationResult.valid) {
      alert(validationResult.message);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Te rugăm să te autentifici mai întâi.");
        router.push("/login");
        return;
      }

      const preparedImages: Array<{
        originalName: string;
        preparedImage: PreparedImage;
      }> = [];

      // Process sequentially to avoid decoding several full-size photos at once.
      for (const file of files) {
        const preparedImage = await prepareImageForUpload(file, {
          preset: "request",
        });

        logPreparedImage(preparedImage);
        preparedImages.push({
          originalName: file.name,
          preparedImage,
        });
      }

      const storedImages = await Promise.all(
        preparedImages.map(({ originalName, preparedImage }) =>
          uploadRepairImage(
            preparedImage,
            originalName,
            authData.user.id,
          ),
        ),
      );

      await createRepairRequest({
        userId: authData.user.id,
        carBrand: draft.carBrand,
        carModel: draft.carModel,
        carYear: draft.carYear,
        city: validationResult.serviceDetails.pickup.city,
        pickupLat: pickupCoordinates?.lat ?? null,
        pickupLng: pickupCoordinates?.lng ?? null,
        destinationLat: destinationCoordinates?.lat ?? null,
        destinationLng: destinationCoordinates?.lng ?? null,
        licensePlate: draft.licensePlate,
        damageType: "towing",
        serviceDetails: validationResult.serviceDetails,
        description: draft.description.trim(),
        serviceType: "towing",
        images: storedImages,
        requestType: targetWorkshopId ? "direct_request" : "repair",
        targetWorkshopId: targetWorkshopId || null,
      });

      sessionStorage.setItem("job-posted-success", "true");
      router.replace("/customer/dashboard?success=posted");
    } catch (error) {
      console.error("Submit failed:", error);
      alert(
        error instanceof Error
          ? error.message
          : "A apărut o problemă la salvarea cererii.",
      );
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400">
          Cerere nouă
        </p>
        <h1 className="mt-2 text-3xl font-black">Tractări auto</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Completează locul de preluare, destinația și starea vehiculului.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <section className="mt-6 rounded-3xl bg-white p-5 text-black shadow-2xl shadow-black/20 md:p-6">
            <h2 className="text-lg font-black">Vehicul</h2>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <FieldLabel label="Marca mașinii">
                <select
                  value={draft.carBrand}
                  onChange={(event) =>
                    updateDraft({
                      carBrand: event.target.value,
                      carModel: "",
                    })
                  }
                  className={lightInputClassName}
                  required
                >
                  <option value="">Alege marca</option>
                  {carBrands.map((brand) => (
                    <option key={brand} value={brand}>
                      {brand}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Model">
                <select
                  value={draft.carModel}
                  onChange={(event) =>
                    updateDraft({ carModel: event.target.value })
                  }
                  disabled={!draft.carBrand}
                  className={`${lightInputClassName} disabled:opacity-50`}
                  required
                >
                  <option value="">
                    {draft.carBrand
                      ? "Alege modelul"
                      : "Alege întâi marca"}
                  </option>
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                  <option value="Alt model">Alt model</option>
                </select>
              </FieldLabel>

              <FieldLabel label="An fabricație">
                <select
                  value={draft.carYear}
                  onChange={(event) =>
                    updateDraft({ carYear: event.target.value })
                  }
                  className={lightInputClassName}
                  required
                >
                  <option value="">Alege anul</option>
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </FieldLabel>

              <FieldLabel label="Număr înmatriculare">
                <div className="relative">
                  <input
                    type="text"
                    value={draft.licensePlate}
                    onChange={(event) =>
                      updateDraft({
                        licensePlate: formatLicensePlateInput(
                          event.target.value,
                        ),
                      })
                    }
                    placeholder="Ex: NT 51 FLY"
                    className={`w-full rounded-2xl border bg-black/[0.03] px-4 py-3 pr-14 outline-none transition ${
                      licensePlateHasError
                        ? "border-red-500 text-red-600 focus:border-red-500"
                        : draft.licensePlate.length > 0
                          ? "border-emerald-500 focus:border-emerald-500"
                          : "border-black/10 focus:border-orange-400"
                    }`}
                    maxLength={11}
                    required
                  />

                  {draft.licensePlate.length > 0 &&
                    (licensePlateHasError ? (
                      <XCircle
                        size={24}
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-red-500"
                      />
                    ) : (
                      <CheckCircle2
                        size={24}
                        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-emerald-500"
                      />
                    ))}
                </div>
                {licensePlateHasError && (
                  <p className="mt-2 text-sm text-red-600">
                    {licensePlateErrorMessage}
                  </p>
                )}
              </FieldLabel>
            </div>
          </section>

          <LocationSection
            title="Locație preluare"
            address={draft.pickupAddress}
            city={draft.pickupCity}
            addressPlaceholder="Stradă, număr, reper"
            onAddressChange={handlePickupAddressChange}
            onCityChange={handlePickupCityChange}
            allowDynamicCity
            locationPreview={
              pickupCoordinates ? (
                <TowingLocationMap
                  lat={pickupCoordinates.lat}
                  lng={pickupCoordinates.lng}
                  onPositionChange={handlePickupPositionChange}
                />
              ) : null
            }
            locationAction={
              <>
                {pickupCoordinates && (
                  <p className="mt-2 text-center text-xs text-white/45">
                    Mută pinul pentru poziția exactă
                  </p>
                )}
                <button
                  type="button"
                  onClick={detectPickupLocation}
                  disabled={isLocatingPickup}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-orange-400/60 bg-orange-500/10 px-4 py-3 text-sm font-bold text-orange-300 transition active:scale-[0.99] disabled:cursor-wait disabled:opacity-60"
                >
                  <MapPin size={18} aria-hidden="true" />
                  {isLocatingPickup
                    ? "Se caută locația..."
                    : "Folosește locația mea"}
                </button>
                <p className="mt-1.5 text-center text-[10px] leading-4 text-white/40">
                  Powered by{" "}
                  <a
                    href="https://www.geoapify.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-white/20 underline-offset-2"
                  >
                    Geoapify
                  </a>{" "}
                  ·{" "}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline decoration-white/20 underline-offset-2"
                  >
                    © OpenStreetMap contributors
                  </a>
                </p>
                {pickupLocationFeedback && (
                  <p
                    className={`mt-2 text-sm font-medium leading-5 ${
                      pickupLocationFeedback.type === "success"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                    aria-live="polite"
                  >
                    {pickupLocationFeedback.message}
                  </p>
                )}
              </>
            }
          />

          <LocationSection
            title="Destinație"
            address={draft.destinationAddress}
            city={draft.destinationCity}
            addressPlaceholder="Adresa unde va fi transportată mașina"
            onAddressChange={handleDestinationAddressChange}
            onCityChange={handleDestinationCityChange}
            allowDynamicCity
            locationPreview={
              destinationCoordinates ? (
                <TowingLocationMap
                  lat={destinationCoordinates.lat}
                  lng={destinationCoordinates.lng}
                  onPositionChange={handleDestinationPositionChange}
                />
              ) : null
            }
            locationAction={
              <>
                {destinationCoordinates && (
                  <p className="mt-2 text-center text-xs text-white/45">
                    Mută pinul pentru poziția exactă
                  </p>
                )}
                {destinationLocationFeedback && (
                  <p
                    className={`mt-2 text-sm font-medium leading-5 ${
                      destinationLocationFeedback.type === "success"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                    aria-live="polite"
                  >
                    {destinationLocationFeedback.message}
                  </p>
                )}
              </>
            }
          />

          <section className={darkSectionClassName}>
            <h2 className="text-base font-black">Motiv tractare</h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {reasonOptions.map((option) => (
                <ChoiceButton
                  key={option.value}
                  selected={draft.reason === option.value}
                  onClick={() => updateDraft({ reason: option.value })}
                >
                  {option.label}
                </ChoiceButton>
              ))}
            </div>
          </section>

          <section className={darkSectionClassName}>
            <h2 className="text-base font-black">Stare vehicul</h2>
            <div className="mt-4 space-y-4">
              <BinaryQuestion
                label="Mașina pornește?"
                value={draft.starts}
                onChange={(starts) => updateDraft({ starts })}
              />
              <BinaryQuestion
                label="Poate fi împinsă?"
                value={draft.canBePushed}
                onChange={(canBePushed) => updateDraft({ canBePushed })}
              />
              <div>
                <p className="text-sm font-semibold text-white/75">Roțile</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {wheelOptions.map((option) => (
                    <ChoiceButton
                      key={option.value}
                      selected={draft.wheels === option.value}
                      onClick={() => updateDraft({ wheels: option.value })}
                    >
                      {option.label}
                    </ChoiceButton>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className={darkSectionClassName}>
            <label className="mb-2 block text-sm font-medium text-white/70">
              Poze (opțional)
            </label>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-8 text-center text-black transition active:scale-[0.99]">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
                📸
              </div>
              <p className="text-base font-bold">Adaugă poze</p>
              <p className="mt-1 text-sm text-black/55">
                Fă poze sau alege din galerie
              </p>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>

            {files.length > 0 && (
              <div className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
                {files.length} poză{files.length > 1 ? "e" : ""} adăugată
                {files.length > 1 ? "e" : ""}
              </div>
            )}

            {files.length > 0 && (
              <div className="mt-4">
                <p className="mb-3 text-sm font-medium text-white/60">
                  Previzualizare poze
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {previewUrls.map((url, index) => {
                    const galleryImages = previewUrls.map(
                      (previewUrl, previewIndex) => ({
                        name:
                          files[previewIndex]?.name ||
                          `Poză ${previewIndex + 1}`,
                        url: previewUrl,
                      }),
                    );

                    return (
                      <div
                        key={`${files[index]?.name || "image"}-${index}`}
                        className="relative overflow-hidden rounded-2xl bg-black/10"
                      >
                        <ImageGallery
                          images={galleryImages}
                          initialIndex={index}
                          hideCountBadge
                          alt={`Poză ${index + 1}`}
                          className="h-28 w-full object-cover"
                          wrapperClassName="block h-28 w-full cursor-pointer overflow-hidden rounded-2xl"
                        />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            removeFile(index);
                          }}
                          className="absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/75 text-sm font-bold text-white shadow-lg backdrop-blur transition active:scale-90 hover:bg-red-600"
                          aria-label={`Șterge poza ${index + 1}`}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className={darkSectionClassName}>
            <label className="mb-2 block text-sm font-medium text-white/70">
              Observații (opțional)
            </label>
            <textarea
              value={draft.description}
              onChange={(event) =>
                updateDraft({ description: event.target.value })
              }
              placeholder="Ex: acces dificil, vehicul într-o parcare subterană..."
              rows={4}
              className={darkInputClassName}
            />
          </section>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full rounded-2xl bg-orange-500 px-6 py-4 font-semibold text-black transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Se postează..." : "Postează cererea"}
          </button>
        </form>
      </div>
    </main>
  );
}

const lightInputClassName =
  "w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400";
const darkInputClassName =
  "w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-orange-400";
const darkSectionClassName =
  "mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4";

function FieldLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-medium text-black/70">
        {label}
      </span>
      {children}
    </label>
  );
}

function LocationSection({
  title,
  address,
  city,
  addressPlaceholder,
  onAddressChange,
  onCityChange,
  allowDynamicCity = false,
  locationAction,
  locationPreview,
}: {
  title: string;
  address: string;
  city: string;
  addressPlaceholder: string;
  onAddressChange: (value: string) => void;
  onCityChange: (value: string) => void;
  allowDynamicCity?: boolean;
  locationAction?: React.ReactNode;
  locationPreview?: React.ReactNode;
}) {
  const hasDynamicCity =
    allowDynamicCity && city !== "" && !romaniaCities.includes(city);

  return (
    <section className={darkSectionClassName}>
      <h2 className="text-base font-black">{title}</h2>
      {locationAction}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <label>
          <span className="mb-2 block text-sm font-medium text-white/70">
            Adresă
          </span>
          <input
            type="text"
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder={addressPlaceholder}
            className={darkInputClassName}
            required
          />
        </label>
        <label>
          <span className="mb-2 block text-sm font-medium text-white/70">
            Oraș
          </span>
          <select
            value={city}
            onChange={(event) => onCityChange(event.target.value)}
            className={darkInputClassName}
            required
          >
            <option value="">Alege orașul</option>
            {hasDynamicCity && <option value={city}>{city}</option>}
            {romaniaCities.map((cityName) => (
              <option key={cityName} value={cityName}>
                {cityName}
              </option>
            ))}
          </select>
        </label>
      </div>
      {locationPreview}
    </section>
  );
}

function ChoiceButton({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition active:scale-[0.98] ${
        selected
          ? "border-orange-400 bg-orange-500 text-black"
          : "border-white/10 bg-black/30 text-white/75"
      }`}
    >
      {children}
    </button>
  );
}

function BinaryQuestion({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-white/75">{label}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <ChoiceButton selected={value === true} onClick={() => onChange(true)}>
          Da
        </ChoiceButton>
        <ChoiceButton
          selected={value === false}
          onClick={() => onChange(false)}
        >
          Nu
        </ChoiceButton>
      </div>
    </div>
  );
}
