"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import ImageGallery from "@/app/components/ImageGallery";
import Wheel3DSelector from "@/app/components/wheels-3d/Wheel3DSelector";
import type {
  WheelComponentSelection,
  WheelComponentServiceSelection,
  WheelPositionId,
} from "@/lib/wheels/wheels-service-details";

type SupplyAnswer = "yes" | "no" | null;

export type WheelsRequestFormValues = {
  selectedServices: WheelComponentServiceSelection[];
  tireWidth: string;
  tireProfile: string;
  rimDiameter: string;
  unknownWheelSize: boolean;
  tireSupply: SupplyAnswer;
  rimSupply: SupplyAnswer;
  files: File[];
  description: string;
};

type WheelsRequestFormProps = {
  validateVehicle?: () => string | null;
  isSubmitting?: boolean;
  onSubmit?: (values: WheelsRequestFormValues) => Promise<void>;
};

export default function WheelsRequestForm({
  validateVehicle,
  isSubmitting = false,
  onSubmit,
}: WheelsRequestFormProps) {
  const [selectedWheels, setSelectedWheels] = useState<WheelPositionId[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<
    WheelComponentSelection[]
  >([]);
  const [selectedServices, setSelectedServices] = useState<
    WheelComponentServiceSelection[]
  >([]);
  const [tireWidth, setTireWidth] = useState("");
  const [tireProfile, setTireProfile] = useState("");
  const [rimDiameter, setRimDiameter] = useState("");
  const [unknownWheelSize, setUnknownWheelSize] = useState(false);
  const [tireSupply, setTireSupply] = useState<SupplyAnswer>(null);
  const [rimSupply, setRimSupply] = useState<SupplyAnswer>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const hasReplaceTire = selectedServices.some(
    (selection) => selection.service === "replace_tire",
  );
  const hasReplaceRim = selectedServices.some(
    (selection) => selection.service === "replace_rim",
  );
  const previewUrls = useMemo(
    () => files.map((file) => URL.createObjectURL(file)),
    [files],
  );

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  function setNumericValue(
    value: string,
    maxLength: number,
    setter: (next: string) => void,
  ) {
    setter(value.replace(/\D/g, "").slice(0, maxLength));
  }

  function handleUnknownWheelSizeChange(checked: boolean) {
    setUnknownWheelSize(checked);

    if (checked) {
      setTireWidth("");
      setTireProfile("");
      setRimDiameter("");
    }
  }

  function handleSelectedServicesChange(
    nextServices: WheelComponentServiceSelection[],
  ) {
    setSelectedServices(nextServices);

    if (!nextServices.some((item) => item.service === "replace_tire")) {
      setTireSupply(null);
    }

    if (!nextServices.some((item) => item.service === "replace_rim")) {
      setRimSupply(null);
    }
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

  async function handleValidate() {
    let validationError: string | null = null;

    if (selectedServices.length === 0) {
      validationError = "Selectează cel puțin un serviciu pentru roți.";
    } else if (
      !unknownWheelSize &&
      (![tireWidth, tireProfile, rimDiameter].every(
        (value) => Number.isInteger(Number(value)) && Number(value) > 0,
      ))
    ) {
      validationError = "Completează o dimensiune validă pentru roți.";
    } else if (hasReplaceTire && tireSupply === null) {
      validationError = "Spune dacă ai deja anvelopa.";
    } else if (hasReplaceRim && rimSupply === null) {
      validationError = "Spune dacă ai deja janta.";
    } else {
      validationError = validateVehicle?.() ?? null;
    }

    if (validationError) {
      alert(validationError);
      return;
    }

    await onSubmit?.({
      selectedServices,
      tireWidth,
      tireProfile,
      rimDiameter,
      unknownWheelSize,
      tireSupply,
      rimSupply,
      files,
      description,
    });
  }

  return (
    <div>
      <Wheel3DSelector
        selectedWheels={selectedWheels}
        onChange={setSelectedWheels}
        selectedComponents={selectedComponents}
        onComponentChange={setSelectedComponents}
        selectedServices={selectedServices}
        onServiceChange={handleSelectedServicesChange}
        model="glb"
      />

      <section className="mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4">
        <h2 className="text-base font-black text-white">
          Dimensiunea roților
        </h2>
        <p className="mt-1 text-sm text-white/55">
          Introdu dimensiunea înscrisă pe anvelopă
        </p>

        <div
          className={`mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 transition-opacity ${
            unknownWheelSize ? "opacity-40" : "opacity-100"
          }`}
        >
          <WheelSizeInput
            label="Lățime"
            value={tireWidth}
            placeholder="225"
            maxLength={3}
            disabled={unknownWheelSize}
            onChange={(value) => setNumericValue(value, 3, setTireWidth)}
          />
          <span className="pt-3 text-lg font-bold text-white/45">/</span>
          <WheelSizeInput
            label="Profil"
            value={tireProfile}
            placeholder="45"
            maxLength={2}
            disabled={unknownWheelSize}
            onChange={(value) => setNumericValue(value, 2, setTireProfile)}
          />
          <span className="pt-3 text-base font-black text-white/55">R</span>
          <WheelSizeInput
            label="Jantă"
            value={rimDiameter}
            placeholder="18"
            maxLength={2}
            disabled={unknownWheelSize}
            onChange={(value) => setNumericValue(value, 2, setRimDiameter)}
          />
        </div>

        <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-white/70">
          <input
            type="checkbox"
            checked={unknownWheelSize}
            onChange={(event) =>
              handleUnknownWheelSizeChange(event.target.checked)
            }
            className="size-5 accent-orange-500"
          />
          Nu știu dimensiunea
        </label>
      </section>

      {(hasReplaceTire || hasReplaceRim) && (
        <section className="mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4">
          <h2 className="text-base font-black text-white">Piese necesare</h2>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {hasReplaceTire && (
              <SupplyQuestion
                question="Ai deja anvelopa?"
                value={tireSupply}
                onChange={setTireSupply}
              />
            )}
            {hasReplaceRim && (
              <SupplyQuestion
                question="Ai deja janta?"
                value={rimSupply}
                onChange={setRimSupply}
              />
            )}
          </div>
        </section>
      )}

      <section className="mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4">
        <label className="mb-2 block text-sm font-medium text-white/70">
          Poze (opțional)
        </label>

        <label className="flex cursor-pointer flex-col items-center justify-center rounded-[22px] border-2 border-dashed border-orange-300 bg-orange-50 px-4 py-8 text-center text-black transition active:scale-[0.99]">
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

      <section className="mt-4 rounded-3xl border border-white/10 bg-neutral-900 p-4">
        <label className="mb-2 block text-sm font-medium text-white/70">
          Descriere scurtă
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Ex: anvelopa pierde aer lent, janta este zgâriată..."
          rows={4}
          className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none transition placeholder:text-white/30 focus:border-orange-400"
        />
      </section>

      {validateVehicle && onSubmit && (
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => void handleValidate()}
          className="mt-6 w-full rounded-2xl bg-orange-500 px-6 py-4 font-semibold text-black transition active:scale-[0.99] disabled:opacity-60"
        >
          {isSubmitting ? "Se salvează..." : "Postează cererea"}
        </button>
      )}
    </div>
  );
}

type SupplyQuestionProps = {
  question: string;
  value: SupplyAnswer;
  onChange: (value: SupplyAnswer) => void;
};

function SupplyQuestion({
  question,
  value,
  onChange,
}: SupplyQuestionProps) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
      <p className="text-sm font-bold text-white">{question}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {[
          { value: "yes" as const, label: "Da" },
          { value: "no" as const, label: "Nu" },
        ].map((option) => {
          const isSelected = value === option.value;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onChange(option.value)}
              className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold transition active:scale-[0.98] ${
                isSelected
                  ? "border-orange-400 bg-orange-500 text-black"
                  : "border-white/10 bg-white/5 text-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

type WheelSizeInputProps = {
  label: string;
  value: string;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
};

function WheelSizeInput({
  label,
  value,
  placeholder,
  maxLength,
  disabled,
  onChange,
}: WheelSizeInputProps) {
  return (
    <label className="min-w-0">
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/30 px-2 text-center text-base font-black text-white outline-none transition placeholder:text-white/25 focus:border-orange-400 disabled:cursor-not-allowed"
      />
      <span className="mt-1 block text-center text-[11px] font-semibold text-white/40">
        {label}
      </span>
    </label>
  );
}
