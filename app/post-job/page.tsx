"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import { romaniaCities } from "@/lib/data/romania-cities";
import {
  formatLicensePlateInput,
  isValidLicensePlate,
  getLicensePlateError,
} from "@/lib/utils/licensePlate";
import ImageGallery from "@/app/components/ImageGallery";
import ServiceOptionGroup from "@/app/components/ServiceOptionGroup";
import ServiceCard from "@/app/components/ServiceCard";
import CarPartSelector from "@/app/components/CarPartSelector";
import { SERVICES } from "@/lib/data/services";

type DamageType =
  | "scratch"
  | "dent"
  | "bumper"
  | "paint"
  | "cracked_part"
  | "other"
  | "detailing_interior"
  | "detailing_exterior"
  | "polish"
  | "ceramic_coating"
  | "ppf"
  | "wrap"
  | "window_tint"
  | "dechroming"
  | "wheel_refurbishment"
  | "smart_repair"
  | "pdr";

type StoredImage = {
  name: string;
  url?: string;
  dataUrl?: string;
};

async function uploadRepairImage(
  file: File,
  userId: string,
): Promise<StoredImage> {
  const fileExt = file.name.split(".").pop() || "jpg";
  const fileName = `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${fileExt}`;

  const { error } = await supabase.storage
    .from("repair-images")
    .upload(fileName, file);

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from("repair-images")
    .getPublicUrl(fileName);

  return {
    name: file.name,
    url: data.publicUrl,
  };
}

export default function PostJobPage() {
  return (
    <Suspense fallback={null}>
      <PostJobContent />
    </Suspense>
  );
}

function PostJobContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetWorkshopId = searchParams.get("targetWorkshopId");

  const [files, setFiles] = useState<File[]>([]);
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [city, setCity] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  const [expandedServices, setExpandedServices] = useState<DamageType[]>([]);
  const [serviceDetails, setServiceDetails] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableModels = carModelsByBrand[carBrand] || [];

  const years = Array.from(
    { length: new Date().getFullYear() - 1989 },
    (_, i) => String(new Date().getFullYear() - i),
  );

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

  const toggleServiceDetail = (detail: string) => {
    setServiceDetails((currentDetails) =>
      currentDetails.includes(detail)
        ? currentDetails.filter((item) => item !== detail)
        : [...currentDetails, detail],
    );
  };

  const serviceHasSelection = (service: DamageType) => {
    if (service === "scratch") {
      return serviceDetails.some(
        (detail) => detail.startsWith("part:") || detail.startsWith("damage:"),
      );
    }

    return serviceDetails.some((detail) => detail.startsWith(`${service}:`));
  };

  const removeSelectedService = (service: DamageType) => {
    setExpandedServices((currentServices) =>
      currentServices.filter((item) => item !== service),
    );

    setServiceDetails((currentDetails) =>
      currentDetails.filter((detail) => {
        if (service === "scratch") {
          return !detail.startsWith("part:") && !detail.startsWith("damage:");
        }

        return !detail.startsWith(`${service}:`);
      }),
    );
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

      if (!isValidLicensePlate(licensePlate)) {
        alert("Introdu un număr de înmatriculare valid.");
        return;
      }

      const availableServiceTypes: DamageType[] = [
        "scratch",
        "detailing_interior",
        "detailing_exterior",
        "polish",
        "ceramic_coating",
        "ppf",
        "wrap",
        "window_tint",
        "dechroming",
        "wheel_refurbishment",
        "smart_repair",
        "pdr",
      ];

      const selectedServiceTypes = availableServiceTypes.filter((service) =>
        serviceHasSelection(service),
      );

      if (selectedServiceTypes.length === 0) {
        alert("Selectează cel puțin o subcategorie.");
        return;
      }

      setIsSubmitting(true);

      const storedImages: StoredImage[] = await Promise.all(
        files.map((file) => uploadRepairImage(file, authData.user.id)),
      );

      const completeServiceDetails = [
        ...selectedServiceTypes.map((service) => `service:${service}`),
        ...serviceDetails,
      ];

      await createRepairRequest({
        userId: authData.user.id,
        carBrand,
        carModel,
        carYear,
        city,
        licensePlate,
        damageType: selectedServiceTypes[0],
        serviceDetails: completeServiceDetails,
        description,
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
      setIsSubmitting(false);
    }
  };

  const licensePlateHasError =
    licensePlate.length > 0 && !isValidLicensePlate(licensePlate);

  const licensePlateErrorMessage = getLicensePlateError(licensePlate);

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5">
          <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
            Daună nouă
          </p>
          <h1 className="mt-2 text-2xl font-bold">Postează dauna</h1>
          <p className="mt-2 text-sm text-white/55">
            Încarcă poze, descrie lucrarea și primești oferte de la service-uri
            specializate.
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
                  setCarBrand(e.target.value);
                  setCarModel("");
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
                onChange={(e) => setCarModel(e.target.value)}
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
                onChange={(e) => setCarYear(e.target.value)}
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
                onChange={(e) => setCity(e.target.value)}
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
                    setLicensePlate(formatLicensePlateInput(e.target.value))
                  }
                  placeholder="Ex: NT 51 FLY"
                  className={`w-full rounded-2xl border bg-black/[0.03] px-4 py-3 pr-12 outline-none transition ${
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

              <div className="space-y-3">
                {SERVICES.map((service) => {
                  const serviceType = service.value as DamageType;
                  const isActive = serviceHasSelection(serviceType);
                  const isExpanded = expandedServices.includes(serviceType);

                  const optionGroups = service.groups || [];
                  const showServiceDetails =
                    isExpanded && optionGroups.length > 0;

                  return (
                    <ServiceCard
                      key={service.value}
                      title={service.title}
                      icon={service.icon}
                      description={service.desc}
                      isActive={isActive}
                      isExpanded={isExpanded}
                      onToggle={() => {
                        setExpandedServices((currentServices) =>
                          currentServices.includes(serviceType)
                            ? currentServices.filter(
                                (item) => item !== serviceType,
                              )
                            : [...currentServices, serviceType],
                        );
                      }}
                      onRemove={() => removeSelectedService(serviceType)}
                    >
                      {showServiceDetails && (
                        <div className="mt-3 rounded-[22px] border border-orange-200 bg-orange-50 p-4">
                          {optionGroups.map((group, groupIndex) => (
                            <div key={`${serviceType}-${group.title}`}>
                              {groupIndex > 0 && (
                                <div className="my-5 h-px bg-black/10" />
                              )}

                              {group.display === "car-parts" ? (
                                <>
                                  <div className="mb-4">
                                    <p className="text-base font-bold text-black">
                                      {group.title}
                                    </p>

                                    <p className="mt-1 text-sm text-black/55">
                                      {group.description}
                                    </p>
                                  </div>

                                  <CarPartSelector
                                    options={group.options}
                                    selectedValues={serviceDetails}
                                    onToggle={toggleServiceDetail}
                                  />
                                </>
                              ) : (
                                <ServiceOptionGroup
                                  title={group.title}
                                  description={group.description}
                                  options={group.options}
                                  selectedValues={serviceDetails}
                                  onToggle={toggleServiceDetail}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </ServiceCard>
                  );
                })}
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-black/70">
                Descriere scurtă
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: ceramic coating complet, detailing interior premium, recondiționare jante, PPF capotă și bară față..."
                rows={4}
                className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-black/70">
                Poze cu dauna
              </label>

              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-8 text-center transition active:scale-[0.99]">
                <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
                  📸
                </div>

                <p className="text-base font-bold text-black">Adaugă poze</p>

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
            {isSubmitting ? "Se salvează..." : "Continuă"}
          </button>
        </form>
      </div>
    </main>
  );
}
