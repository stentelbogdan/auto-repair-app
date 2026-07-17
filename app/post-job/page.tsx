"use client";

import {
  ChangeEvent,
  FormEvent,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Check, CheckCircle2, ChevronDown, X, XCircle } from "lucide-react";
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

type ServiceDetailOption = {
  value: string;
  label: string;
};

const carPartDetails: ServiceDetailOption[] = [
  { value: "part:front_bumper", label: "Bară față" },
  { value: "part:rear_bumper", label: "Bară spate" },

  { value: "part:hood", label: "Capotă" },
  { value: "part:roof", label: "Pavilion" },
  { value: "part:trunk", label: "Capac portbagaj / Hayon" },

  { value: "part:left_front_fender", label: "Aripă față stânga" },
  { value: "part:right_front_fender", label: "Aripă față dreapta" },

  { value: "part:left_rear_quarter", label: "Aripă spate stânga" },
  { value: "part:right_rear_quarter", label: "Aripă spate dreapta" },

  { value: "part:left_front_door", label: "Ușă față stânga" },
  { value: "part:left_rear_door", label: "Ușă spate stânga" },

  { value: "part:right_front_door", label: "Ușă față dreapta" },
  { value: "part:right_rear_door", label: "Ușă spate dreapta" },

  { value: "part:left_sill", label: "Prag stânga" },
  { value: "part:right_sill", label: "Prag dreapta" },

  { value: "part:left_mirror", label: "Oglindă stânga" },
  { value: "part:right_mirror", label: "Oglindă dreapta" },

  { value: "part:left_headlight", label: "Far stânga" },
  { value: "part:right_headlight", label: "Far dreapta" },

  { value: "part:left_taillight", label: "Stop spate stânga" },
  { value: "part:right_taillight", label: "Stop spate dreapta" },

  { value: "part:left_front_wheel", label: "Jantă față stânga" },
  { value: "part:right_front_wheel", label: "Jantă față dreapta" },
  { value: "part:left_rear_wheel", label: "Jantă spate stânga" },
  { value: "part:right_rear_wheel", label: "Jantă spate dreapta" },

  { value: "part:windshield", label: "Parbriz / Geam" },

  { value: "part:other", label: "Alt element" },
];

const damageKindDetails: ServiceDetailOption[] = [
  { value: "damage:scratch", label: "Zgârietură" },
  { value: "damage:dent", label: "Îndoitură" },
  { value: "damage:crack", label: "Crăpătură" },
  { value: "damage:broken", label: "Element spart" },
  { value: "damage:deformed", label: "Element deformat" },
  { value: "damage:paint_damage", label: "Vopsea deteriorată" },
  { value: "damage:paint_peeling", label: "Vopsea exfoliată" },
  { value: "damage:rust", label: "Rugină / Coroziune" },
  { value: "damage:stone_chips", label: "Ciobituri de pietre" },
  { value: "damage:replacement", label: "Necesită înlocuire" },
  { value: "damage:painting", label: "Necesită vopsire" },
  { value: "damage:other", label: "Alt tip de daună" },
];

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
                {[
                  {
                    value: "scratch",
                    title: "Reparație daună",
                    icon: "🚗",
                    desc: "Zgârieturi, lovituri, vopsitorie",
                  },
                  {
                    value: "detailing_interior",
                    title: "Detailing interior",
                    icon: "✨",
                    desc: "Curățare premium interior",
                  },
                  {
                    value: "detailing_exterior",
                    title: "Detailing exterior",
                    icon: "🧽",
                    desc: "Curățare și protecție exterior",
                  },
                  {
                    value: "polish",
                    title: "Polish profesional",
                    icon: "💎",
                    desc: "Corecție lac și luciu",
                  },
                  {
                    value: "ceramic_coating",
                    title: "Ceramic coating",
                    icon: "🛡️",
                    desc: "Protecție ceramică vopsea",
                  },
                  {
                    value: "ppf",
                    title: "PPF",
                    icon: "🧊",
                    desc: "Folie protecție vopsea",
                  },
                  {
                    value: "wrap",
                    title: "Colantări auto",
                    icon: "🎨",
                    desc: "Schimbare culoare / design",
                  },
                  {
                    value: "window_tint",
                    title: "Folii geamuri",
                    icon: "🕶️",
                    desc: "Folie solară geamuri",
                  },
                  {
                    value: "dechroming",
                    title: "Dechroming",
                    icon: "⚫",
                    desc: "Elemente cromate transformate negru",
                  },
                  {
                    value: "wheel_refurbishment",
                    title: "Recondiționare jante",
                    icon: "🛞",
                    desc: "Reparație, vopsire, diamond cut",
                  },
                  {
                    value: "smart_repair",
                    title: "Smart Repair",
                    icon: "🔧",
                    desc: "Reparații mici și rapide",
                  },
                  {
                    value: "pdr",
                    title: "PDR",
                    icon: "🔨",
                    desc: "Îndreptare fără vopsire",
                  },
                ].map((service) => {
                  const serviceType = service.value as DamageType;
                  const isActive = serviceHasSelection(serviceType);
                  const isExpanded = expandedServices.includes(serviceType);

                  const showRepairDetails =
                    serviceType === "scratch" && isExpanded;

                  return (
                    <div key={service.value}>
                      <div
                        className={`relative overflow-hidden rounded-2xl border transition ${
                          isActive
                            ? "border-orange-400 bg-orange-50 shadow-sm"
                            : "border-black/10 bg-black/[0.03] hover:border-orange-300"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const nextDamageType = service.value as DamageType;

                            setExpandedServices((currentServices) =>
                              currentServices.includes(nextDamageType)
                                ? currentServices.filter(
                                    (item) => item !== nextDamageType,
                                  )
                                : [...currentServices, nextDamageType],
                            );
                          }}
                          className="w-full p-4 pr-14 text-left transition active:scale-[0.99]"
                          aria-expanded={isExpanded}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
                              {service.icon}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-bold text-black">
                                  {service.title}
                                </p>

                                {isActive && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-bold text-black">
                                    <Check size={13} strokeWidth={3} />
                                    Selectat
                                  </span>
                                )}
                              </div>

                              <p className="mt-1 text-sm text-black/55">
                                {service.desc}
                              </p>
                            </div>
                          </div>
                        </button>

                        <div className="absolute right-3 top-3 flex items-center gap-1">
                          {isActive && (
                            <button
                              type="button"
                              onClick={() => removeSelectedService(serviceType)}
                              className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-black/50 shadow-sm transition hover:bg-red-50 hover:text-red-600 active:scale-90"
                              aria-label={`Elimină serviciul ${service.title}`}
                              title="Elimină serviciul"
                            >
                              <X size={17} />
                            </button>
                          )}

                          <ChevronDown
                            size={20}
                            className={`pointer-events-none text-black/45 transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                        </div>
                      </div>

                      {showRepairDetails && (
                        <div className="mt-3 rounded-[22px] border border-orange-200 bg-orange-50 p-4">
                          <p className="text-sm font-bold text-black">
                            Ce element este afectat?
                          </p>

                          <p className="mt-1 text-xs text-black/55">
                            Poți selecta unul sau mai multe elemente.
                          </p>

                          <div className="mt-4 space-y-2">
                            {carPartDetails.map((detail) => {
                              const isSelected = serviceDetails.includes(
                                detail.value,
                              );

                              return (
                                <button
                                  key={detail.value}
                                  type="button"
                                  onClick={() =>
                                    toggleServiceDetail(detail.value)
                                  }
                                  aria-pressed={isSelected}
                                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.99] ${
                                    isSelected
                                      ? "border-orange-500 bg-orange-500 text-black"
                                      : "border-black/10 bg-white text-black"
                                  }`}
                                >
                                  <span>{detail.label}</span>

                                  <span
                                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                                      isSelected
                                        ? "border-black bg-black text-white"
                                        : "border-black/15 bg-white text-transparent"
                                    }`}
                                  >
                                    ✓
                                  </span>
                                </button>
                              );
                            })}
                          </div>

                          <div className="my-5 h-px bg-black/10" />

                          <p className="text-sm font-bold text-black">
                            Ce tip de daună are?
                          </p>

                          <p className="mt-1 text-xs text-black/55">
                            Poți selecta unul sau mai multe tipuri de daună.
                          </p>

                          <div className="mt-4 space-y-2">
                            {damageKindDetails.map((detail) => {
                              const isSelected = serviceDetails.includes(
                                detail.value,
                              );

                              return (
                                <button
                                  key={detail.value}
                                  type="button"
                                  onClick={() =>
                                    toggleServiceDetail(detail.value)
                                  }
                                  aria-pressed={isSelected}
                                  className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition active:scale-[0.99] ${
                                    isSelected
                                      ? "border-orange-500 bg-orange-500 text-black"
                                      : "border-black/10 bg-white text-black"
                                  }`}
                                >
                                  <span>{detail.label}</span>

                                  <span
                                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${
                                      isSelected
                                        ? "border-black bg-black text-white"
                                        : "border-black/15 bg-white text-transparent"
                                    }`}
                                  >
                                    ✓
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
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
