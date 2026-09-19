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
          <h2 className="text-base font-black">Fotografii (opțional)</h2>
          <label className="mt-3 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-orange-300/50 bg-orange-500/5 px-4 py-6 text-center">
            <span className="text-3xl">📸</span><span className="mt-2 font-bold">Adaugă fotografii</span>
            <input type="file" multiple accept="image/*" onChange={handleFileChange} className="hidden" />
          </label>
          {previewUrls.length > 0 && <div className="mt-4 grid grid-cols-3 gap-3">{previewUrls.map((url, index) => <div key={url} className="relative overflow-hidden rounded-2xl"><ImageGallery images={previewUrls.map((dataUrl) => ({ dataUrl }))} initialIndex={index} hideCountBadge alt={`Poză ${index + 1}`} className="h-28 w-full object-cover" wrapperClassName="block h-28 w-full overflow-hidden rounded-2xl" /><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-2 top-2 z-20 h-8 w-8 rounded-full bg-black/75 text-white">✕</button></div>)}</div>}
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
