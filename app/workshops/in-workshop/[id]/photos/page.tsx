"use client";

import ImageGallery from "@/app/components/ImageGallery";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";
import { supabase } from "@/lib/supabase/client";
import { saveWorkProgressUpdate } from "@/lib/supabase/work-progress";
import {
  formatProgressStatus,
  isProgressStatusValidForWorkflow,
  normalizeProgressStatus,
  type ProgressStatus,
} from "@/lib/work-progress/workflows";
import { Camera, Images } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { resolveRepairServiceType } from "@/lib/repair-requests/service-types";

type RequestSummary = {
  car_brand: string | null;
  car_model: string | null;
  service_type: string | null;
};

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\ncontext: work-progress-photos\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}`,
  );
}

export default function WorkProgressPhotosPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = params.id;
  const submittingRef = useRef(false);
  const previewUrlsRef = useRef<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ProgressStatus | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [progressImages, setProgressImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;

    const loadPage = async () => {
      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser();

        if (authError) throw authError;
        if (!authData.user) {
          router.push("/login");
          return;
        }

        const [requestResult, progressResult] = await Promise.all([
          supabase
            .from("repair_requests")
            .select("car_brand, car_model, service_type")
            .eq("id", requestId)
            .maybeSingle(),
          supabase
            .from("work_progress_updates")
            .select("status")
            .eq("request_id", requestId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (requestResult.error) throw requestResult.error;
        if (progressResult.error) throw progressResult.error;
        if (!requestResult.data) {
          throw new Error("Lucrarea nu a fost găsită.");
        }
        if (!active) return;

        setUserId(authData.user.id);
        setRequest(requestResult.data);
        const resolvedServiceType = resolveRepairServiceType(
          requestResult.data.service_type,
        );

        if (!resolvedServiceType) {
          setFeedback({
            type: "error",
            message:
              "Tipul lucrării nu are un workflow de progres recunoscut. Pozele nu pot fi trimise.",
          });
          return;
        }

        if (!progressResult.data?.status) {
          setFeedback({
            type: "error",
            message:
              "Setează mai întâi etapa curentă din cardul Ceas, apoi revino pentru a trimite poze.",
          });
        } else if (
          !isProgressStatusValidForWorkflow(
            progressResult.data.status,
            resolvedServiceType,
          )
        ) {
          setFeedback({
            type: "error",
            message: `Statusul curent „${formatProgressStatus(progressResult.data.status)}” nu este compatibil cu workflow-ul ${resolvedServiceType === "mechanical" ? "mecanic" : resolvedServiceType === "wheels" ? "de roți și anvelope" : "de caroserie"}. Pozele nu pot fi trimise până la clarificarea datelor.`,
          });
        } else {
          setCurrentStatus(normalizeProgressStatus(progressResult.data.status));
        }
      } catch (error) {
        if (!active) return;

        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Pagina foto nu a putut fi încărcată.",
        });
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadPage();

    return () => {
      active = false;
    };
  }, [requestId, router]);

  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const handleImages = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (files.length === 0) return;

    const newPreviewUrls = files.map((file) => URL.createObjectURL(file));

    setProgressImages((current) => [...current, ...files]);
    setPreviewUrls((current) => {
      const next = [...current, ...newPreviewUrls];
      previewUrlsRef.current = next;
      return next;
    });
    setFeedback(null);
  };

  const removeProgressImage = (index: number) => {
    const previewUrl = previewUrlsRef.current[index];
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    setProgressImages((current) =>
      current.filter((_, imageIndex) => imageIndex !== index),
    );
    setPreviewUrls((current) => {
      const next = current.filter((_, imageIndex) => imageIndex !== index);
      previewUrlsRef.current = next;
      return next;
    });
  };

  const submitPhotos = async () => {
    if (submittingRef.current) return;

    if (!userId || !currentStatus) {
      setFeedback({
        type: "error",
        message:
          "Setează mai întâi etapa curentă din cardul Ceas, apoi revino pentru a trimite poze.",
      });
      return;
    }

    if (progressImages.length === 0) {
      setFeedback({
        type: "error",
        message: "Adaugă cel puțin o fotografie înainte de trimitere.",
      });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setFeedback(null);

    try {
      const preparedImages: PreparedImage[] = [];

      for (const file of progressImages) {
        const preparedImage = await prepareImageForUpload(file, {
          preset: "workProgress",
        });
        logPreparedImage(preparedImage);
        preparedImages.push(preparedImage);
      }

      const uploadedUrls: string[] = [];

      for (const preparedImage of preparedImages) {
        const filePath = `${requestId}/${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${preparedImage.extension}`;

        const { error: uploadError } = await supabase.storage
          .from("work-progress")
          .upload(filePath, preparedImage.file, {
            contentType: preparedImage.contentType,
          });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage
          .from("work-progress")
          .getPublicUrl(filePath);

        uploadedUrls.push(data.publicUrl);
      }

      await saveWorkProgressUpdate({
        requestId,
        senderId: userId,
        status: currentStatus,
        message,
        images: uploadedUrls,
      });

      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
      setPreviewUrls([]);
      setProgressImages([]);
      setMessage("");
      setFeedback({
        type: "success",
        message: "Pozele au fost trimise către client.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Pozele nu au putut fi trimise.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă pagina foto...
      </main>
    );
  }

  const requestTitle = request
    ? `${request.car_brand || "Mașină"} ${request.car_model || ""}`.trim()
    : "Lucrare";

  return (
    <main className="min-h-screen bg-black px-4 pb-28 pt-4 text-white">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80"
        >
          ← Înapoi
        </button>

        <section className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-400">
            Poze progres
          </p>
          <h1 className="mt-2 text-2xl font-black tracking-tight">
            {requestTitle}
          </h1>
          <p className="mt-2 text-sm text-white/55">
            Etapa curentă: {currentStatus ? formatProgressStatus(currentStatus) : "nesetată"}
          </p>
        </section>

        <section className="mt-5 rounded-[28px] border border-white/10 bg-white/[0.04] p-5">
          <h2 className="text-xl font-bold">Trimite poze către client</h2>
          <p className="mt-2 text-sm text-white/50">
            Adaugă o descriere și fotografii din atelier.
          </p>

          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ex: Elementele au fost pregătite și urmează următoarea operațiune..."
            className="mt-4 min-h-[120px] w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none"
          />

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-orange-400/40 bg-orange-500/10 px-3 text-center">
              <Camera size={28} className="text-orange-300" />
              <span className="mt-2 text-sm font-bold">Deschide camera</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImages}
                className="hidden"
              />
            </label>

            <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-black/40 px-3 text-center">
              <Images size={28} className="text-white/70" />
              <span className="mt-2 text-sm font-bold">Alege din galerie</span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImages}
                className="hidden"
              />
            </label>
          </div>

          {previewUrls.length > 0 && (
            <div className="mt-4">
              <ImageGallery
                images={previewUrls.map((url, index) => ({
                  name: `progress-preview-${index}`,
                  url,
                }))}
                alt="Poze progres"
                className="h-48 w-full object-cover"
                wrapperClassName="block w-full overflow-hidden rounded-2xl"
              />

              <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {previewUrls.map((url, index) => (
                  <div
                    key={url}
                    className="relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-white/5"
                  >
                    <div
                      className="h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${url})` }}
                      role="img"
                      aria-label={`Previzualizare imagine ${index + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeProgressImage(index)}
                      disabled={submitting}
                      className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-black/80 text-base font-bold text-white disabled:opacity-50"
                      aria-label={`Șterge imaginea ${index + 1}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                feedback.type === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/20 bg-red-500/10 text-red-300"
              }`}
            >
              {feedback.message}
            </div>
          )}

          <button
            type="button"
            onClick={() => void submitPhotos()}
            disabled={
              submitting || !currentStatus || progressImages.length === 0
            }
            className="mt-5 w-full rounded-2xl bg-orange-500 px-5 py-4 text-sm font-black text-black hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Se trimit pozele..." : "Trimite poze către client"}
          </button>
        </section>
      </div>
    </main>
  );
}
