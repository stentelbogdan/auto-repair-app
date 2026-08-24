"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import LicensePlate from "@/app/components/LicensePlate";
import ImageGallery from "@/app/components/ImageGallery";
import dynamic from "next/dynamic";
import ServiceOptionGroup from "@/app/components/ServiceOptionGroup";
import { SERVICES } from "@/lib/data/services";
import type { StructuredServiceDetails } from "@/lib/supabase/repair-requests";
import {
  deleteEditableRepairRequest,
  getEditableRepairRequest,
  updateEditableRepairRequest,
  uploadEditableRepairImages,
  type EditableRepairImage,
  type EditableRepairRequest,
} from "@/lib/supabase/edit-repair-request";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";
import { Check } from "lucide-react";
import { isStructuredServiceDetails } from "@/lib/car-damage";
import {
  MECHANICAL_CATEGORIES,
  isMechanicalCategoryId,
  type MechanicalCategoryId,
} from "@/lib/mechanical/mechanical-categories";
import {
  buildMechanicalServiceDetails,
  getMechanicalSymptomIdsByCategory,
  normalizeMechanicalServiceDetails,
  type MechanicalSymptomIdsByCategory,
} from "@/lib/mechanical/mechanical-service-details";
import { resolveRepairServiceType } from "@/lib/repair-requests/service-types";

const Car3DViewer = dynamic(
  () => import("@/app/components/car-3d/Car3DViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[280px] items-center justify-center text-sm text-white/55 [@media(min-height:700px)]:h-[clamp(300px,34svh,360px)]">
        Se încarcă selectorul 3D...
      </div>
    ),
  },
);

export default function EditMyRequestPage() {
  /*
   * Routerul rămâne numai pentru redirecturile automate:
   * autentificare și cerere inexistentă.
   */
  const router = useRouter();

  const params = useParams();
  const searchParams = useSearchParams();

  const { navigate, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const from = searchParams.get("from") || "waiting";
  const requestId = params.id as string;

  const [request, setRequest] = useState<EditableRepairRequest | null>(null);
  const [description, setDescription] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [serviceDetails, setServiceDetails] = useState<string[]>([]);
  const [mechanicalSymptomsByCategory, setMechanicalSymptomsByCategory] =
    useState<MechanicalSymptomIdsByCategory>({});
  const [activeMechanicalCategory, setActiveMechanicalCategory] =
    useState<MechanicalCategoryId | null>(null);
  const [expandedMechanicalCategory, setExpandedMechanicalCategory] =
    useState<MechanicalCategoryId | null>(null);
  const [images, setImages] = useState<EditableRepairImage[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [offersCount, setOffersCount] = useState(0);
  const [is3DReady, setIs3DReady] = useState(false);

  const selectedCarParts = useMemo(
    () =>
      serviceDetails
        .filter((detail) => detail.startsWith("part:"))
        .map((detail) => detail.slice("part:".length)),
    [serviceDetails],
  );

  const damageOptionGroups = useMemo(() => {
    const repairService = SERVICES.find(
      (service) => service.value === "scratch",
    );

    return (repairService?.groups || []).filter(
      (group) => group.display !== "car-parts",
    );
  }, []);

  const canEdit = useMemo(() => {
    return !request?.accepted_offer_id && request?.status === "open";
  }, [request]);

  const handleSelectedCarPartsChange = (partIds: string[]) => {
    if (!canEdit) return;

    setServiceDetails((currentDetails) => {
      const detailsWithoutCarParts = currentDetails.filter(
        (detail) => !detail.startsWith("part:"),
      );

      const nextCarParts = partIds.map((partId) => `part:${partId}`);

      return [...detailsWithoutCarParts, ...nextCarParts];
    });
  };

  const toggleServiceDetail = (detail: string) => {
    if (!canEdit) return;

    setServiceDetails((currentDetails) =>
      currentDetails.includes(detail)
        ? currentDetails.filter((item) => item !== detail)
        : [...currentDetails, detail],
    );
  };

  const toggleMechanicalCategory = (category: MechanicalCategoryId) => {
    if (canEdit) {
      setActiveMechanicalCategory(category);
    }

    setExpandedMechanicalCategory((current) =>
      current === category ? null : category,
    );
  };

  const toggleMechanicalSymptom = (
    categoryId: MechanicalCategoryId,
    symptomId: string,
  ) => {
    if (!canEdit) return;

    const category = MECHANICAL_CATEGORIES.find(
      (item) => item.id === categoryId,
    );

    if (!category?.symptoms.some((symptom) => symptom.id === symptomId)) {
      return;
    }

    setActiveMechanicalCategory(categoryId);
    setMechanicalSymptomsByCategory((current) => {
      const selectedSymptoms = current[categoryId] ?? [];
      const nextSymptoms = selectedSymptoms.includes(symptomId)
        ? selectedSymptoms.filter((id) => id !== symptomId)
        : [...selectedSymptoms, symptomId];

      return {
        ...current,
        [categoryId]: nextSymptoms,
      };
    });
  };

  useEffect(() => {
    let cancelled = false;

    const loadRequest = async () => {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (cancelled) {
          return;
        }

        if (authError) {
          throw authError;
        }

        if (!authData.user) {
          /*
           * Redirect automat de autentificare.
           * Nu trece prin useSafeNavigation.
           */
          router.replace("/login");
          return;
        }

        const result = await getEditableRepairRequest(
          requestId,
          authData.user.id,
        );

        if (cancelled) {
          return;
        }

        if (!result) {
          window.alert("Cererea nu a fost găsită.");

          /*
           * Redirect automat după un rezultat invalid.
           */
          router.replace("/customer/my-requests");
          return;
        }

        const loadedRequest = result.request;

        setRequest(loadedRequest);
        setOffersCount(result.offersCount);

        setDescription(loadedRequest.description || "");
        setLicensePlate(loadedRequest.license_plate || "");

        setImages(
          Array.isArray(loadedRequest.images) ? loadedRequest.images : [],
        );

        const resolvedServiceType = resolveRepairServiceType(
          loadedRequest.service_type,
        );

        if (resolvedServiceType === "mechanical") {
          const normalizedDetails = normalizeMechanicalServiceDetails(
            loadedRequest.service_details,
          );
          const fallbackCategory = isMechanicalCategoryId(
            loadedRequest.damage_type,
          )
            ? loadedRequest.damage_type
            : null;
          const primaryCategory =
            normalizedDetails?.selections[0]?.category ?? fallbackCategory;

          setMechanicalSymptomsByCategory(
            getMechanicalSymptomIdsByCategory(loadedRequest.service_details),
          );
          setActiveMechanicalCategory(primaryCategory);
          setExpandedMechanicalCategory(primaryCategory);
          setServiceDetails([]);
          return;
        }

        if (resolvedServiceType !== "bodywork") {
          setServiceDetails([]);
          return;
        }

        const structuredDetails = loadedRequest.service_details;

        if (!isStructuredServiceDetails(structuredDetails)) {
          setServiceDetails([]);
          return;
        }

        setServiceDetails([
          ...structuredDetails.carDamage.parts.map((part) => `part:${part}`),

          ...structuredDetails.carDamage.damages.map(
            (damage) => `damage:${damage}`,
          ),

          ...structuredDetails.options,
        ]);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load editable request:", error);
        window.alert("Nu am putut încărca cererea.");
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (requestId) {
      void loadRequest();
    }

    return () => {
      cancelled = true;
    };
  }, [requestId, router]);

  useEffect(() => {
    if (
      !request ||
      resolveRepairServiceType(request.service_type) !== "bodywork"
    ) {
      setIs3DReady(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setIs3DReady(true);
    }, 600);

    return () => {
      window.clearTimeout(timer);
    };
  }, [request]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setNewFiles(Array.from(e.target.files));
  };

  const handleSave = async () => {
    if (!request || !canEdit) return;

    const resolvedServiceType = resolveRepairServiceType(request.service_type);

    if (
      resolvedServiceType !== "bodywork" &&
      resolvedServiceType !== "mechanical"
    ) {
      alert("Editarea acestui tip de cerere nu este disponibilă încă.");
      return;
    }

    const isMechanicalRequest = resolvedServiceType === "mechanical";
    const nextMechanicalServiceDetails = isMechanicalRequest
      ? buildMechanicalServiceDetails(mechanicalSymptomsByCategory)
      : null;
    const nextMechanicalDamageType = isMechanicalRequest
      ? (nextMechanicalServiceDetails?.selections[0]?.category ??
        activeMechanicalCategory ??
        (isMechanicalCategoryId(request.damage_type)
          ? request.damage_type
          : null))
      : null;

    if (isMechanicalRequest && !nextMechanicalDamageType) {
      alert("Selectează o categorie mecanică înainte de salvare.");
      return;
    }

    try {
      setSaving(true);

      const uploadedImages = await uploadEditableRepairImages(
        newFiles,
        request.user_id,
      );
      const nextImages = [...images, ...uploadedImages];
      let savedServiceDetails = request.service_details;
      let savedDamageType = request.damage_type;

      if (isMechanicalRequest) {
        if (!nextMechanicalServiceDetails || !nextMechanicalDamageType) {
          throw new Error("Datele mecanice nu sunt valide.");
        }

        await updateEditableRepairRequest({
          serviceType: "mechanical",
          requestId: request.id,
          userId: request.user_id,
          licensePlate,
          serviceDetails: nextMechanicalServiceDetails,
          damageType: nextMechanicalDamageType,
          description,
          images: nextImages,
        });

        savedServiceDetails = nextMechanicalServiceDetails;
        savedDamageType = nextMechanicalDamageType;
      } else {
        const selectedDamageTypes = serviceDetails
          .filter((detail) => detail.startsWith("damage:"))
          .map((detail) => detail.slice("damage:".length));

        const otherServiceOptions = serviceDetails.filter(
          (detail) =>
            !detail.startsWith("part:") && !detail.startsWith("damage:"),
        );
        const currentStructuredDetails = isStructuredServiceDetails(
          request.service_details,
        )
          ? request.service_details
          : null;
        const nextBodyworkServiceDetails: StructuredServiceDetails = {
          version: 1,
          selectedServices: currentStructuredDetails?.selectedServices.length
            ? currentStructuredDetails.selectedServices
            : [request.damage_type],
          carDamage: {
            parts: selectedCarParts,
            damages: selectedDamageTypes,
          },
          options: otherServiceOptions,
        };

        await updateEditableRepairRequest({
          serviceType: "bodywork",
          requestId: request.id,
          userId: request.user_id,
          licensePlate,
          serviceDetails: nextBodyworkServiceDetails,
          description,
          images: nextImages,
        });

        savedServiceDetails = nextBodyworkServiceDetails;
      }

      setImages(nextImages);
      setNewFiles([]);

      setRequest((currentRequest) =>
        currentRequest
          ? {
              ...currentRequest,
              service_details: savedServiceDetails,
              damage_type: savedDamageType,
              description,
              images: nextImages,
            }
          : currentRequest,
      );
      alert("Modificările au fost salvate.");
    } catch (error) {
      console.error(error);
      alert("Nu am putut salva modificările.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!request || !canEdit) return;

    const hasOffers = offersCount > 0;

    const confirmed = confirm(
      hasOffers
        ? "Această cerere are deja oferte. Vrei să o închizi? Service-urile nu o vor mai vedea."
        : "Sigur vrei să ștergi această cerere? Acțiunea nu poate fi anulată.",
    );

    if (!confirmed) return;

    try {
      setDeleting(true);

      await deleteEditableRepairRequest({
        requestId: request.id,
        userId: request.user_id,
        hasOffers,
      });

      navigate("/customer/my-requests");
    } catch (error) {
      console.error(error);
      alert(
        hasOffers
          ? "Nu am putut închide cererea."
          : "Nu am putut șterge cererea.",
      );
    } finally {
      setDeleting(false);
    }
  };

  const goBackToRequests = () => {
    const targetTab =
      from === "waiting" || from === "with_offer" || from === "archive"
        ? from
        : "waiting";

    sessionStorage.setItem("my-requests-active-tab", targetTab);

    navigate("/customer/my-requests");
  };

  const removeImage = (index: number) => {
    if (!canEdit) return;
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  if (!request) return null;

  const resolvedServiceType = resolveRepairServiceType(request.service_type);
  const isMechanicalRequest = resolvedServiceType === "mechanical";
  const isUnsupportedRequest =
    resolvedServiceType !== "bodywork" && resolvedServiceType !== "mechanical";

  return (
    <main className="min-h-screen bg-black px-4 pb-40 pt-6 text-white">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={goBackToRequests}
          disabled={isNavigating}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition disabled:cursor-not-allowed disabled:opacity-50"
        >
          ← Înapoi la cererile mele
        </button>

        <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
          {isMechanicalRequest
            ? "Editare problemă mecanică"
            : isUnsupportedRequest
              ? "Detalii cerere"
              : "Editare daună"}
        </p>

        <LicensePlate plate={licensePlate} className="mt-4" />

        <h1 className="mt-3 text-3xl font-black">
          {request.car_brand} {request.car_model}
        </h1>

        <p className="mt-2 text-white/50">
          {request.car_year} • {request.city}
        </p>

        <section className="mt-6 rounded-[28px] bg-white p-5 text-black">
          {isUnsupportedRequest ? (
            <div className="rounded-2xl border border-black/10 bg-black/[0.03] p-4">
              <p className="text-sm font-semibold text-black/70">
                Editarea acestui tip de cerere nu este disponibilă încă.
              </p>
            </div>
          ) : isMechanicalRequest ? (
            <div>
              <p className="text-sm font-semibold text-black/60">
                Categorii și simptome
              </p>
              <p className="mt-1 text-xs leading-5 text-black/45">
                Deschide fiecare categorie și modifică simptomele observate.
              </p>

              <div className="mt-4 space-y-3">
                {MECHANICAL_CATEGORIES.map((category) => {
                  const selectedSymptoms =
                    mechanicalSymptomsByCategory[category.id] ?? [];
                  const isExpanded =
                    expandedMechanicalCategory === category.id;
                  const isActive =
                    activeMechanicalCategory === category.id ||
                    selectedSymptoms.length > 0;

                  return (
                    <div
                      key={category.id}
                      className={`overflow-hidden rounded-2xl border transition ${
                        isActive
                          ? "border-orange-300 bg-orange-50"
                          : "border-black/10 bg-black/[0.03]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleMechanicalCategory(category.id)}
                        className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left"
                        aria-expanded={isExpanded}
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-sm">
                          {category.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-bold text-black">
                            {category.label}
                          </span>
                          <span className="mt-0.5 block text-xs text-black/50">
                            {selectedSymptoms.length}{" "}
                            {selectedSymptoms.length === 1
                              ? "simptom selectat"
                              : "simptome selectate"}
                          </span>
                        </span>
                        <span className="text-lg text-black/35" aria-hidden="true">
                          {isExpanded ? "−" : "+"}
                        </span>
                      </button>

                      {isExpanded && (
                        <div className="space-y-2 border-t border-black/10 p-3">
                          {category.symptoms.map((symptom) => {
                            const selected = selectedSymptoms.includes(
                              symptom.id,
                            );

                            return (
                              <button
                                key={symptom.id}
                                type="button"
                                disabled={!canEdit}
                                aria-pressed={selected}
                                onClick={() =>
                                  toggleMechanicalSymptom(
                                    category.id,
                                    symptom.id,
                                  )
                                }
                                className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                                  selected
                                    ? "border-orange-400 bg-orange-100 text-black"
                                    : "border-black/10 bg-white text-black/65"
                                }`}
                              >
                                <span>{symptom.label}</span>
                                <span
                                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                                    selected
                                      ? "border-orange-500 bg-orange-500 text-white"
                                      : "border-black/15 text-transparent"
                                  }`}
                                  aria-hidden="true"
                                >
                                  <Check size={14} strokeWidth={3} />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-black/60">
                  Elemente afectate
                </p>

                {canEdit && (
                  <p className="mt-1 text-xs text-black/45">
                    Modifică elementele avariate direct pe modelul 3D.
                  </p>
                )}

                <div className="mt-4 overflow-hidden rounded-[28px] bg-gradient-to-b from-[#2a303a] via-[#222832] to-[#1b2028] shadow-[0_18px_45px_rgba(0,0,0,0.18)]">
                  {is3DReady ? (
                    <Car3DViewer
                      mode={canEdit ? "selection" : "preview"}
                      heightClassName="h-[280px] [@media(min-height:700px)]:h-[clamp(300px,34svh,360px)]"
                      selectedPartIds={selectedCarParts}
                      onSelectedPartIdsChange={handleSelectedCarPartsChange}
                      cameraPositionOverride={[8.15, 1.9, 0.35]}
                      cameraTargetOverride={[0.35, 0.4, 0]}
                      cameraFovOverride={46}
                      modelScaleOverride={canEdit ? 1.3 : 0.75}
                      modelPositionOverride={[0.35, -0.18, 0]}
                    />
                  ) : (
                    <div className="flex h-[280px] items-center justify-center text-sm text-white/55 [@media(min-height:700px)]:h-[clamp(300px,34svh,360px)]">
                      Se încarcă selectorul 3D...
                    </div>
                  )}
                </div>
              </div>

              {damageOptionGroups.map((group) => (
                <div
                  key={group.title}
                  className="mt-5 rounded-[22px] border border-orange-200 bg-orange-50 py-4"
                >
                  <ServiceOptionGroup
                    title={group.title}
                    description={group.description}
                    options={group.options}
                    selectedValues={serviceDetails}
                    onToggle={toggleServiceDetail}
                  />
                </div>
              ))}
            </>
          )}

          <div className="my-6 h-px bg-black/10" />
          <label className="text-sm font-semibold text-black/60">
            Descriere problemă
          </label>

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            className="mt-3 min-h-[150px] w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-base outline-none disabled:opacity-60"
            placeholder="Adaugă detalii despre daună..."
          />

          <div className="mt-6">
            <p className="text-sm font-semibold text-black/60">
              Poze existente
            </p>

            {images.length === 0 ? (
              <div className="mt-3 rounded-2xl bg-black/5 p-6 text-center text-sm text-black/45">
                Nu ai poze încă.
              </div>
            ) : canEdit ? (
              <div className="mt-3 grid grid-cols-3 gap-3">
                {images.map((image, index) => {
                  const src =
                    image.thumbUrl || image.url || image.dataUrl || "";

                  return (
                    <div
                      key={`${src}-${index}`}
                      className="relative overflow-hidden rounded-2xl bg-black/10"
                    >
                      {src ? (
                        <img
                          src={src}
                          alt={`Imagine daună ${index + 1}`}
                          className="h-24 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center text-xs text-black/40">
                          Fără poză
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white"
                        aria-label={`Șterge imaginea ${index + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3">
                <ImageGallery
                  images={images}
                  alt={`${request.car_brand} ${request.car_model}`}
                  className="h-52 w-full object-cover"
                  wrapperClassName="block w-full overflow-hidden rounded-2xl"
                />
              </div>
            )}
          </div>

          {canEdit && (
            <div className="mt-6">
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-orange-300 bg-orange-50 px-4 py-8 text-center">
                <span className="text-3xl">📸</span>
                <span className="mt-2 font-bold">Adaugă poze</span>
                <span className="mt-1 text-sm text-black/50">
                  Poți adăuga poze noi la cererea ta
                </span>

                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleFiles}
                  className="hidden"
                />
              </label>

              {newFiles.length > 0 && (
                <p className="mt-3 text-sm text-black/55">
                  {newFiles.length} poze selectate
                </p>
              )}
            </div>
          )}

          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="mt-6 w-full rounded-2xl bg-black px-5 py-4 font-bold text-white disabled:opacity-50"
            >
              {saving ? "Se salvează..." : "Salvează modificările"}
            </button>
          )}
        </section>

        {!canEdit && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm leading-6 text-amber-200">
            Această cerere are deja un service selectat și nu mai poate fi
            editată sau ștearsă.
          </div>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="relative z-10 mt-5 w-full rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 font-bold text-red-300 disabled:opacity-50"
          >
            {deleting
              ? offersCount > 0
                ? "Se închide..."
                : "Se șterge..."
              : offersCount > 0
                ? "Închide cererea"
                : "Șterge cererea"}
          </button>
        )}
      </div>
    </main>
  );
}
