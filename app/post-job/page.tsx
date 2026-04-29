"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairRequest } from "@/lib/supabase/repair-requests";
import { carBrands, carModelsByBrand } from "@/lib/data/car-data";
import { romaniaCities } from "@/lib/data/romania-cities";

type DamageType =
  | "scratch"
  | "dent"
  | "bumper"
  | "paint"
  | "cracked_part"
  | "other";

type StoredImage = {
  name: string;
  url?: string;
  dataUrl?: string;
};

async function uploadRepairImage(file: File, userId: string): Promise<StoredImage> {
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
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [city, setCity] = useState("");
  const [damageType, setDamageType] = useState<DamageType>("scratch");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableModels = carModelsByBrand[carBrand] || [];

  const years = Array.from(
  { length: new Date().getFullYear() - 1989 },
  (_, i) => String(new Date().getFullYear() - i)
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
  const selectedFiles = Array.from(e.target.files || []);

  if (selectedFiles.length === 0) {
    return;
  }

  setFiles((previousFiles) => {
    const updatedFiles = [...previousFiles, ...selectedFiles];

    return updatedFiles.slice(0, 8);
  });

  e.currentTarget.value = "";
};

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Te rugăm să te autentifici mai întâi.");
        router.push("/login");
        return;
      }

      const storedImages: StoredImage[] = await Promise.all(
        files.map((file) => uploadRepairImage(file, authData.user.id))
      );

      const createdRequest = await createRepairRequest({
        userId: authData.user.id,
        carBrand,
        carModel,
        carYear,
        city,
        damageType,
        description,
        images: storedImages,
      });

      router.push(`/review?id=${createdRequest.id}`);
    } catch (error) {
      console.error("Submit failed:", error);
      alert(
        error instanceof Error
        ? error.message
        : "A apărut o problemă la salvarea cererii."
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
            Daună nouă
          </p>
          <h1 className="mt-2 text-2xl font-bold">Postează dauna</h1>
          <p className="mt-2 text-sm text-white/55">
            Încarcă poze, descrie dauna și primești oferte de la service-uri.
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

        <div className="md:col-span-2">
        <label className="mb-2 block text-sm font-medium text-black/70">
            Tip daună
        </label>

        <select
            value={damageType}
            onChange={(e) => setDamageType(e.target.value as DamageType)}
            className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 outline-none focus:border-orange-400"
        >
        <option value="scratch">Zgârietură</option>
        <option value="dent">Îndoitură</option>
        <option value="bumper">Bară avariată</option>
        <option value="paint">Problemă vopsea</option>
        <option value="cracked_part">Element crăpat</option>
        <option value="other">Altă daună</option>
        </select>
        </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-black/70">
                Descriere scurtă
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: bara față zgâriată, ușa stângă îndoită, aripa trebuie vopsită..."
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

                    <p className="text-base font-bold text-black">
                        Adaugă poze
                    </p>

                    <p className="mt-1 text-sm text-black/55">
                        Fă poze sau alege din galerie
                    </p>

                    <input
                        type="file"
                        multiple
                        accept="image/*"
                        capture="environment"
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
                {previewUrls.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Poză ${index + 1}`}
                    className="h-28 w-full rounded-2xl object-cover"
                  />
                ))}
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