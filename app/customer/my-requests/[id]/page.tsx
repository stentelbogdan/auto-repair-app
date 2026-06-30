"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import LicensePlate from "@/app/components/LicensePlate";
import {
  formatLicensePlateInput,
  formatLicensePlateForDb,
} from "@/lib/utils/licensePlate";

type RepairImage = {
  name?: string;
  url?: string;
  thumbUrl?: string;
  dataUrl?: string;
};

type RepairRequest = {
  id: string;
  user_id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  license_plate: string | null;
  damage_type: string;
  description: string | null;
  images: RepairImage[] | null;
  status: string;
  accepted_offer_id: string | null;
};

export default function EditMyRequestPage() {
  const router = useRouter();
  const params = useParams();
  const requestId = params.id as string;

  const [request, setRequest] = useState<RepairRequest | null>(null);
  const [description, setDescription] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [images, setImages] = useState<RepairImage[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [offersCount, setOffersCount] = useState(0);

  const canEdit = useMemo(() => {
    return !request?.accepted_offer_id && request?.status === "open";
  }, [request]);

  useEffect(() => {
    const loadRequest = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data, error } = await supabase
          .from("repair_requests")
          .select(
            "id, user_id, car_brand, car_model, car_year, city, license_plate, damage_type, description, images, status, accepted_offer_id",
          )
          .eq("id", requestId)
          .eq("user_id", authData.user.id)
          .maybeSingle<RepairRequest>();

        if (error) throw error;

        if (!data) {
          alert("Cererea nu a fost găsită.");
          router.push("/customer/my-requests");
          return;
        }

        setRequest(data);
        setDescription(data.description || "");
        setLicensePlate(data.license_plate || "");
        setImages(Array.isArray(data.images) ? data.images : []);

        const { count, error: offersCountError } = await supabase
          .from("repair_offers")
          .select("id", { count: "exact", head: true })
          .eq("request_id", requestId);

        if (offersCountError) throw offersCountError;

        setOffersCount(count ?? 0);
      } catch (error) {
        console.error(error);
        alert("Nu am putut încărca cererea.");
      } finally {
        setLoading(false);
      }
    };

    if (requestId) loadRequest();
  }, [requestId, router]);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    setNewFiles(Array.from(e.target.files));
  };

  const uploadImages = async (userId: string) => {
    const uploaded: RepairImage[] = [];

    for (const file of newFiles) {
      const fileExt = file.name.split(".").pop() || "jpg";
      const fileName = `${userId}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${fileExt}`;

      const { error } = await supabase.storage
        .from("repair-images")
        .upload(fileName, file);

      if (error) throw error;

      const { data } = supabase.storage
        .from("repair-images")
        .getPublicUrl(fileName);

      uploaded.push({
        name: file.name,
        url: data.publicUrl,
      });
    }

    return uploaded;
  };

  const handleSave = async () => {
    if (!request || !canEdit) return;

    try {
      setSaving(true);

      const uploadedImages = await uploadImages(request.user_id);
      const nextImages = [...images, ...uploadedImages];

      const { error } = await supabase
        .from("repair_requests")
        .update({
          license_plate: formatLicensePlateForDb(licensePlate),
          description,
          images: nextImages,
        })
        .eq("id", request.id)
        .eq("user_id", request.user_id);

      if (error) throw error;

      setImages(nextImages);
      setNewFiles([]);
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

      if (hasOffers) {
        const { error } = await supabase
          .from("repair_requests")
          .update({ status: "closed" })
          .eq("id", request.id)
          .eq("user_id", request.user_id)
          .eq("status", "open");

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("repair_requests")
          .delete()
          .eq("id", request.id)
          .eq("user_id", request.user_id)
          .eq("status", "open");

        if (error) throw error;
      }

      router.refresh();
      router.push("/customer/my-requests");
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

  return (
    <main className="min-h-screen bg-black px-4 pb-40 pt-6 text-white">
      <div className="mx-auto max-w-md">
        <button
          onClick={() => router.push("/customer/my-requests")}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/80"
        >
          ← Înapoi la daunele mele
        </button>

        <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
          Editare daună
        </p>

        <LicensePlate plate={licensePlate} className="mt-4" />

        <h1 className="mt-3 text-3xl font-black">
          {request.car_brand} {request.car_model}
        </h1>

        <p className="mt-2 text-white/50">
          {request.car_year} • {request.city}
        </p>

        {!canEdit && (
          <div className="mt-5 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-200">
            Această cerere are deja un service selectat și nu mai poate fi
            editată sau ștearsă.
          </div>
        )}

        <section className="mt-6 rounded-[28px] bg-white p-5 text-black">
          <div className="mb-6">
            <label className="text-sm font-semibold text-black/60">
              Număr de înmatriculare
            </label>

            <input
              type="text"
              value={licensePlate}
              onChange={(e) =>
                setLicensePlate(formatLicensePlateInput(e.target.value))
              }
              disabled={!canEdit}
              className="mt-3 w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3 text-base font-bold uppercase outline-none disabled:opacity-60"
              placeholder="Ex: BH 73 JDJ"
            />
          </div>

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
            ) : (
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
                          alt=""
                          className="h-24 w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center text-xs text-black/40">
                          Fără poză
                        </div>
                      )}

                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="absolute right-1 top-1 rounded-full bg-black/70 px-2 py-1 text-xs text-white"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
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
              onClick={handleSave}
              disabled={saving}
              className="mt-6 w-full rounded-2xl bg-black px-5 py-4 font-bold text-white disabled:opacity-50"
            >
              {saving ? "Se salvează..." : "Salvează modificările"}
            </button>
          )}
        </section>

        {canEdit && (
          <button
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
