"use client";

import { Suspense, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import WheelsRequestForm, {
  type WheelsRequestFormValues,
} from "@/app/components/wheels/WheelsRequestForm";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import { romaniaCities } from "@/lib/data/romania-cities";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";
import {
  removeRepairImageUploadsBestEffort,
  uploadPreparedRepairImages,
} from "@/lib/supabase/repair-request-images";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { supabase } from "@/lib/supabase/client";
import {
  formatLicensePlateInput,
  getLicensePlateError,
  isValidLicensePlate,
} from "@/lib/utils/licensePlate";
import {
  normalizeWheelsServiceDetailsV2,
  type WheelPartsSupply,
} from "@/lib/wheels/wheels-service-details";

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}`,
  );
}

function toPartsSupply(
  value: WheelsRequestFormValues["tireSupply"],
): WheelPartsSupply {
  if (value === "yes") return "customer";
  if (value === "no") return "workshop";
  return null;
}

type WheelsVehicleDraft = {
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  licensePlate: string;
  targetWorkshopId: string | null;
};

const initialVehicleDraft: WheelsVehicleDraft = {
  carBrand: "",
  carModel: "",
  carYear: "",
  city: "",
  licensePlate: "",
  targetWorkshopId: null,
};

export default function PostWheelsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
          <p className="text-sm text-white/65">Se încarcă...</p>
        </main>
      }
    >
      <PostWheelsContent />
    </Suspense>
  );
}

function PostWheelsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetWorkshopId = searchParams.get("targetWorkshopId");
  const [draft, setDraft] = useState<WheelsVehicleDraft>(() => ({
    ...initialVehicleDraft,
    targetWorkshopId,
  }));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const { carBrand, carModel, carYear, city, licensePlate } = draft;
  const availableModels = carModelsByBrand[carBrand] || [];
  const years = Array.from(
    { length: new Date().getFullYear() - 1989 },
    (_, index) => String(new Date().getFullYear() - index),
  );
  const licensePlateHasError =
    licensePlate.length > 0 && !isValidLicensePlate(licensePlate);
  const licensePlateErrorMessage = getLicensePlateError(licensePlate);

  function updateDraft(patch: Partial<WheelsVehicleDraft>) {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }));
  }

  function validateVehicle() {
    if (!carBrand) return "Selectează marca mașinii.";
    if (!carModel) return "Selectează modelul mașinii.";
    if (!carYear) return "Selectează anul fabricației.";
    if (!city) return "Selectează localitatea.";
    if (!isValidLicensePlate(licensePlate)) {
      return "Introdu un număr de înmatriculare valid.";
    }

    return null;
  }

  async function handleSubmit(values: WheelsRequestFormValues) {
    if (isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let uploadedImagePaths: string[] = [];
    let requestCreated = false;

    try {
      const serviceDetails = normalizeWheelsServiceDetailsV2({
        selectedServices: values.selectedServices,
        tireWidth: values.tireWidth,
        tireProfile: values.tireProfile,
        rimDiameter: values.rimDiameter,
        unknownWheelSize: values.unknownWheelSize,
        tireSupply: toPartsSupply(values.tireSupply),
        rimSupply: toPartsSupply(values.rimSupply),
      });

      if (!serviceDetails) {
        alert("Detaliile pentru roți nu sunt valide.");
        return;
      }

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
      for (const file of values.files) {
        const preparedImage = await prepareImageForUpload(file, {
          preset: "request",
        });

        logPreparedImage(preparedImage);
        preparedImages.push({
          originalName: file.name,
          preparedImage,
        });
      }

      const storedImages = await uploadPreparedRepairImages(
        preparedImages,
        authData.user.id,
      );
      uploadedImagePaths = storedImages.flatMap((image) =>
        image.path ? [image.path] : [],
      );

      await createRepairRequest({
        userId: authData.user.id,
        carBrand,
        carModel,
        carYear,
        city,
        licensePlate,
        damageType: "wheels",
        serviceDetails,
        description: values.description,
        serviceType: "wheels",
        images: storedImages,
        requestType: draft.targetWorkshopId ? "direct_request" : "repair",
        targetWorkshopId: draft.targetWorkshopId || null,
      });
      requestCreated = true;

      sessionStorage.setItem("job-posted-success", "true");
      router.replace("/customer/dashboard?success=posted");
    } catch (error) {
      if (!requestCreated) {
        await removeRepairImageUploadsBestEffort(uploadedImagePaths);
      }
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
    <main className="min-h-screen bg-black px-4 pb-5 pt-6 text-white md:py-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6 text-center">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white md:text-[30px]">
            Roți și anvelope
          </h1>
          <p className="mx-auto mt-2.5 max-w-2xl text-sm leading-5 text-white/60">
            Selectează serviciile pentru roți și anvelope și primește oferte de
            la service-uri specializate.
          </p>
        </header>

        <section className="rounded-3xl bg-white p-5 text-black shadow-2xl shadow-black/20 md:p-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Marca mașinii
              </label>
              <select
                value={carBrand}
                onChange={(event) =>
                  updateDraft({
                    carBrand: event.target.value,
                    carModel: "",
                  })
                }
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
                required
              >
                <option value="">Alege marca</option>
                {carBrands.map((brand) => (
                  <option key={brand} value={brand}>
                    {brand}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Model
              </label>
              <select
                value={carModel}
                onChange={(event) =>
                  updateDraft({ carModel: event.target.value })
                }
                disabled={!carBrand}
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400 disabled:opacity-50"
                required
              >
                <option value="">
                  {carBrand ? "Alege modelul" : "Alege întâi marca"}
                </option>
                {availableModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
                <option value="Alt model">Alt model</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                An fabricație
              </label>
              <select
                value={carYear}
                onChange={(event) =>
                  updateDraft({ carYear: event.target.value })
                }
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
                required
              >
                <option value="">Alege anul</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Localitate
              </label>
              <select
                value={city}
                onChange={(event) => updateDraft({ city: event.target.value })}
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
                required
              >
                <option value="">Alege localitatea</option>
                {romaniaCities.map((cityName) => (
                  <option key={cityName} value={cityName}>
                    {cityName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Număr înmatriculare
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={licensePlate}
                  onChange={(event) =>
                    updateDraft({
                      licensePlate: formatLicensePlateInput(event.target.value),
                    })
                  }
                  placeholder="Ex: NT 51 FLY"
                  className={`w-full rounded-2xl border bg-black/[0.03] px-4 py-3 pr-14 outline-none transition ${
                    licensePlateHasError
                      ? "border-red-500 text-red-600 focus:border-red-500"
                      : licensePlate.length > 0
                        ? "border-emerald-500 focus:border-emerald-500"
                        : "border-black/10 focus:border-orange-400"
                  }`}
                  maxLength={11}
                  required
                />

                {licensePlate.length > 0 &&
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
            </div>
          </div>
        </section>

        <div className="mt-4">
          <WheelsRequestForm
            validateVehicle={validateVehicle}
            isSubmitting={isSubmitting}
            onSubmit={handleSubmit}
          />
        </div>
      </div>
    </main>
  );
}
