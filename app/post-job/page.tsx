"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairRequest } from "@/lib/supabase/repair-requests";

type DamageType =
  | "scratch"
  | "dent"
  | "bumper"
  | "paint"
  | "cracked_part"
  | "other";

type StoredImage = {
  name: string;
  dataUrl: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to read file"));
      }
    };

    reader.onerror = () => reject(new Error("File reading failed"));
    reader.readAsDataURL(file);
  });
}

export default function Home() {
  const router = useRouter();

  const [files, setFiles] = useState<File[]>([]);
  const [carBrand, setCarBrand] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [city, setCity] = useState("");
  const [damageType, setDamageType] = useState<DamageType>("scratch");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    setFiles(selectedFiles);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Please log in first.");
        router.push("/login");
        return;
      }

      const storedImages: StoredImage[] = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          dataUrl: await fileToBase64(file),
        }))
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
      alert("Something went wrong while saving the repair request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 text-center">
          <h1 className="font-bold">Upload your car damage</h1>
          <p className="mt-3 text-white/70">
            Get multiple repair offers from trusted workshops and choose the best
            price.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-white/80">
                Car brand
              </label>
              <input
                type="text"
                value={carBrand}
                onChange={(e) => setCarBrand(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/80">
                Car model
              </label>
              <input
                type="text"
                value={carModel}
                onChange={(e) => setCarModel(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/80">Year</label>
              <input
                type="number"
                value={carYear}
                onChange={(e) => setCarYear(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/80">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-white/80">
                Damage type
              </label>
              <select
                value={damageType}
                onChange={(e) => setDamageType(e.target.value as DamageType)}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
              >
                <option value="scratch">Scratch</option>
                <option value="dent">Dent</option>
                <option value="bumper">Bumper damage</option>
                <option value="paint">Paint damage</option>
                <option value="cracked_part">Cracked part</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-white/80">
                Short description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the damage clearly (e.g. front bumper scratched, left door dented)"
                rows={4}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
              />
            </div>

            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-white/80">
                Upload photos
              </label>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleFileChange}
                className="block w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 text-sm"
              />
            </div>
          </div>

          {files.length > 0 && (
            <div className="mt-4 rounded-lg border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/70">
              {files.length} photo{files.length > 1 ? "s" : ""} selected
            </div>
          )}

          {files.length > 0 && (
            <div className="mt-4">
              <p className="mb-3 text-sm text-white/70">Photo preview</p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {previewUrls.map((url, index) => (
                  <img
                    key={index}
                    src={url}
                    alt={`Preview ${index + 1}`}
                    className="h-32 w-full rounded-lg border border-white/10 object-cover"
                  />
                ))}
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-6 w-full rounded-lg bg-white px-6 py-3 font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
          >
            {isSubmitting ? "Processing..." : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}