"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ImageGallery from "@/app/components/ImageGallery";
import TowingRequestForm, { validateTowingRequestFormValues, type TowingRequestFormValues } from "@/app/components/towing/TowingRequestForm";
import { prepareImageForUpload, type PreparedImage } from "@/lib/images/prepare-image-for-upload";
import { removeRepairImageUploadsBestEffort, uploadPreparedRepairImages } from "@/lib/supabase/repair-request-images";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { supabase } from "@/lib/supabase/client";

function logPreparedImage(image: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;
  const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  console.info(`[IMAGE-PREP]\noriginal: ${image.originalWidth}x${image.originalHeight} / ${size(image.originalSize)}\nfinal: ${image.width}x${image.height} / ${size(image.finalSize)}\ntargetSizeMet: ${image.targetSizeMet}`);
}

export default function PostTowingPage() {
  return <Suspense fallback={<main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white"><p className="text-sm text-white/65">Se încarcă...</p></main>}><PostTowingContent /></Suspense>;
}

function PostTowingContent() {
  const router = useRouter();
  const targetWorkshopId = useSearchParams().get("targetWorkshopId");
  const [towingValues, setTowingValues] = useState<TowingRequestFormValues | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const previewUrls = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);

  useEffect(() => () => previewUrls.forEach((url) => URL.revokeObjectURL(url)), [previewUrls]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []);
    if (selected.length) setFiles((current) => [...current, ...selected].slice(0, 8));
    event.currentTarget.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current || !towingValues) return;
    const validation = validateTowingRequestFormValues(towingValues);
    if (!validation.valid) {
      alert(validation.message);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    let uploadedPaths: string[] = [];
    let requestCreated = false;
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        alert("Te rugăm să te autentifici mai întâi.");
        router.push("/login");
        return;
      }

      const prepared: Array<{ originalName: string; preparedImage: PreparedImage }> = [];
      for (const file of files) {
        const preparedImage = await prepareImageForUpload(file, { preset: "request" });
        logPreparedImage(preparedImage);
        prepared.push({ originalName: file.name, preparedImage });
      }
      const storedImages = await uploadPreparedRepairImages(prepared, data.user.id);
      uploadedPaths = storedImages.flatMap((image) => image.path ? [image.path] : []);
      const values = validation.values;
      if (!values.pickupDiscoveryLocation) {
        throw new Error("Locația de preluare nu a putut fi validată.");
      }

      await createRepairRequest({
        userId: data.user.id,
        carBrand: values.carBrand,
        carModel: values.carModel,
        carYear: values.carYear,
        city: values.city,
        pickupLat: values.pickupCoordinates?.lat ?? null,
        pickupLng: values.pickupCoordinates?.lng ?? null,
        destinationLat: values.destinationCoordinates?.lat ?? null,
        destinationLng: values.destinationCoordinates?.lng ?? null,
        routeDistanceMeters: values.route?.distanceMeters ?? null,
        routeDurationSeconds: values.route?.durationSeconds ?? null,
        routePaths: values.route?.paths ?? null,
        towingScheduleType: values.scheduleType,
        towingRequestedAt: values.requestedAt,
        towingRequestedTimezone: values.requestedTimezone,
        licensePlate: values.licensePlate,
        damageType: "towing",
        serviceDetails: values.serviceDetails,
        description: description.trim(),
        serviceType: "towing",
        images: storedImages,
        requestType: targetWorkshopId ? "direct_request" : "repair",
        targetWorkshopId: targetWorkshopId || null,
        discoveryLocation: {
          ...values.pickupDiscoveryLocation,
          source: "towing_pickup",
        },
      });
      requestCreated = true;
      sessionStorage.setItem("job-posted-success", "true");
      router.replace("/customer/dashboard?success=posted");
    } catch (error) {
      if (!requestCreated) await removeRepairImageUploadsBestEffort(uploadedPaths);
      console.error("Submit failed:", error);
      alert(error instanceof Error ? error.message : "A apărut o problemă la salvarea cererii.");
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return <main className="min-h-screen bg-black px-4 pb-5 pt-6 text-white md:py-10">
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 text-center">
        <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white md:text-[30px]">Tractări auto</h1>
        <p className="mx-auto mt-2.5 max-w-2xl text-sm leading-5 text-white/60">Setează preluarea și destinația și primește oferte pentru transportul mașinii tale.</p>
      </header>
      <form onSubmit={handleSubmit} noValidate>
        <TowingRequestForm onValuesChange={setTowingValues} />
        <section className={sectionClassName}>
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
            <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
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
                          setFiles((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          );
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
        <section className={sectionClassName}>
          <label className="mb-2 block text-sm font-medium text-white/70">Observații (opțional)</label>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Ex: acces dificil, vehicul într-o parcare subterană..." rows={4} className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none placeholder:text-white/30 focus:border-orange-400" />
        </section>
        <button type="submit" disabled={isSubmitting} className="mt-6 w-full rounded-2xl bg-orange-500 px-6 py-4 font-semibold text-black disabled:opacity-60">{isSubmitting ? "Se postează..." : "Postează cererea"}</button>
      </form>
    </div>
  </main>;
}

const sectionClassName = "mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4";
