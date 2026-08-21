"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import { romaniaCities } from "@/lib/data/romania-cities";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  formatLicensePlateInput,
  isValidLicensePlate,
  getLicensePlateError,
} from "@/lib/utils/licensePlate";
import ImageGallery from "@/app/components/ImageGallery";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";
import { MECHANICAL_CATEGORIES } from "@/lib/mechanical/mechanical-categories";
import type {
  MechanicalCategorySelection,
  MechanicalServiceDetails,
} from "@/lib/mechanical/mechanical-service-details";
import { useMechanicalDraft } from "./MechanicalDraftProvider";

type StoredImage = {
  name: string;
  url?: string;
  dataUrl?: string;
};

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

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from("repair-images")
    .getPublicUrl(fileName);

  return {
    name: originalName,
    url: data.publicUrl,
  };
}

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}`,
  );
}

export default function PostJobPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
          <p className="text-sm text-white/65">Se incarca...</p>
        </main>
      }
    >
      <PostJobContent />
    </Suspense>
  );
}

function PostJobContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetWorkshopId = searchParams.get("targetWorkshopId");
  const { draft, files, isHydrated, setFiles, updateDraft, resetDraft } =
    useMechanicalDraft();
  const {
    carBrand,
    carModel,
    carYear,
    city,
    licensePlate,
    category: damageType,
    symptomIdsByCategory,
    description,
  } = draft;

  const licensePlateHasError =
    licensePlate.length > 0 && !isValidLicensePlate(licensePlate);

  const licensePlateErrorMessage = getLicensePlateError(licensePlate);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableModels = carModelsByBrand[carBrand] || [];

  const years = Array.from(
    { length: new Date().getFullYear() - 1989 },
    (_, i) => String(new Date().getFullYear() - i),
  );

  useEffect(() => {
    if (!isHydrated || draft.targetWorkshopId === targetWorkshopId) return;
    updateDraft({ targetWorkshopId });
  }, [draft.targetWorkshopId, isHydrated, targetWorkshopId, updateDraft]);

  const previewUrls = useMemo(() => {
    return files.map((file) => URL.createObjectURL(file));
  }, [files]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const newFiles = Array.from(e.target.files || []);

    if (newFiles.length === 0) return;

    setFiles((currentFiles) => {
      const updatedFiles = [...currentFiles, ...newFiles];
      return updatedFiles.slice(0, 8);
    });

    e.currentTarget.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Te rugăm să te autentifici mai întâi.");
        router.push("/login");
        return;
      }

      if (!damageType) {
        alert("Selectează categoria problemei.");
        return;
      }

      const trimmedDescription = description.trim();

      if (trimmedDescription.length < 10) {
        alert("Descrie problema în cel puțin 10 caractere.");
        return;
      }

      if (!isValidLicensePlate(licensePlate)) {
        alert("Introdu un număr de înmatriculare valid.");
        return;
      }

      const activeCategory = MECHANICAL_CATEGORIES.find(
        (category) => category.id === damageType,
      );

      if (!activeCategory) {
        alert("Categoria selectată nu este validă.");
        return;
      }

      const selections: MechanicalCategorySelection[] = [];

      for (const category of MECHANICAL_CATEGORIES) {
        const selectedSymptomIds = new Set(
          symptomIdsByCategory[category.id] ?? [],
        );
        const validSymptomIds = category.symptoms
          .filter((symptom) => selectedSymptomIds.has(symptom.id))
          .map((symptom) => symptom.id);

        if (validSymptomIds.length > 0) {
          selections.push({
            category: category.id,
            symptomIds: validSymptomIds,
          });
        }
      }

      const mechanicalServiceDetails: MechanicalServiceDetails = {
        version: 2,
        kind: "mechanical",
        selections,
      };
      const primaryDamageType = selections[0]?.category ?? damageType;

      setIsSubmitting(true);

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

      const storedImages: StoredImage[] = await Promise.all(
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
        carBrand,
        carModel,
        carYear,
        city,
        licensePlate,
        damageType: primaryDamageType,
        serviceDetails: mechanicalServiceDetails,
        description: trimmedDescription,
        serviceType: "mechanical",
        images: storedImages,
        requestType: targetWorkshopId ? "direct_request" : "repair",
        targetWorkshopId: targetWorkshopId || null,
      });

      resetDraft();
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
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
            Problemă mecanică
          </p>
          <h1 className="mt-2 text-2xl font-bold">
            Postează problema mecanică
          </h1>
          <p className="mt-2 text-sm text-white/55">
            Descrie problema și primești oferte de la service-uri specializate.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-[24px] bg-white p-5 text-black shadow-xl"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-black/70">
                Marca mașinii
              </label>

              <select
                value={carBrand}
                onChange={(e) => {
                  updateDraft({ carBrand: e.target.value, carModel: "" });
                }}
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
                onChange={(e) => updateDraft({ carModel: e.target.value })}
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
                onChange={(e) => updateDraft({ carYear: e.target.value })}
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
                onChange={(e) => updateDraft({ city: e.target.value })}
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
                  onChange={(e) =>
                    updateDraft({
                      licensePlate: formatLicensePlateInput(e.target.value),
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

            <div className="md:col-span-2">
              <label className="mb-3 block text-sm font-medium text-black/70">
                Ce serviciu dorești?
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                {MECHANICAL_CATEGORIES.map((category) => {
                  const symptomCount =
                    symptomIdsByCategory[category.id]?.length ?? 0;

                  return (
                    <button
                      key={category.id}
                      type="button"
                      onClick={() => {
                        updateDraft({ targetWorkshopId });

                        const query = targetWorkshopId
                          ? `?targetWorkshopId=${encodeURIComponent(targetWorkshopId)}`
                          : "";

                        router.replace(
                          `/post-mechanical/${category.id}${query}`,
                        );
                      }}
                      className={`rounded-2xl border p-4 text-left transition active:scale-[0.98] ${
                        damageType === category.id
                          ? "border-orange-400 bg-orange-50 shadow-sm"
                          : "border-black/10 bg-black/[0.03] hover:border-orange-300"
                      }`}
                    >
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
                        {category.icon}
                      </div>

                      <p className="font-bold text-black">{category.label}</p>
                      <p className="mt-1 text-sm text-black/55">
                        {category.description}
                      </p>
                      {symptomCount > 0 && (
                        <p className="mt-2 text-xs font-semibold text-orange-600">
                          {symptomCount} simptom
                          {symptomCount === 1 ? " selectat" : "e selectate"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-black/70">
                Descrie simptomele
              </label>
              <p className="mb-3 text-sm text-black/50">
                Spune ce observi, când apare problema și orice detaliu care poate
                ajuta service-ul.
              </p>
              <textarea
                value={description}
                onChange={(e) => updateDraft({ description: e.target.value })}
                placeholder="Ex: se aprinde martorul motor, mașina nu mai trage, se aude un zgomot la suspensie..."
                rows={4}
                aria-required="true"
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-black/70">
                Poze (opțional)
              </label>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-8 text-center transition active:scale-[0.99]">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
                  📸
                </div>

                <p className="text-base font-bold text-black">Adaugă poze</p>

                <p className="mt-1 text-sm text-black/55">
                  Poți încărca poze cu martori din bord, scurgeri sau piese
                  defecte
                </p>

                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-4 rounded-2xl bg-orange-50 px-4 py-3 text-sm font-semibold text-orange-700">
              {files.length} poză{files.length > 1 ? "e" : ""} adăugată
              {files.length > 1 ? "e" : ""}
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-4">
              <p className="mb-3 text-sm font-medium text-black/60">
                Previzualizare poze
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {previewUrls.map((url, index) => {
                  const galleryImages = previewUrls.map(
                    (previewUrl, previewIndex) => ({
                      name:
                        files[previewIndex]?.name || `Poză ${previewIndex + 1}`,
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

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full rounded-2xl bg-black px-6 py-4 font-semibold text-white transition active:scale-[0.99] disabled:opacity-60"
          >
            {isSubmitting ? "Se salvează..." : "Postează cererea"}
          </button>
        </form>
      </div>
    </main>
  );
}
