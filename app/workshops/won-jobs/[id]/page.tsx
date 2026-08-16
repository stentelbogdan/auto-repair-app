"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ImageGallery from "@/app/components/ImageGallery";
import {
  prepareImageForUpload,
  type PreparedImage,
} from "@/lib/images/prepare-image-for-upload";

const bodyworkProgressSteps = [
  "Received",
  "Disassembly",
  "Body repair",
  "Paint preparation",
  "Painting",
  "Polishing",
  "Ready",
];

const mechanicalProgressSteps = [
  "Received",
  "Diagnosis",
  "Parts ordered",
  "In repair",
  "Testing",
  "Ready",
];

const statusLabels: Record<string, string> = {
  Received: "Primită",
  Disassembly: "Demontare",
  "Body repair": "Tinichigerie",
  "Paint preparation": "Pregătire vopsire",
  Painting: "Vopsire",
  Polishing: "Polish",
  Diagnosis: "Diagnoză",
  "Parts ordered": "Piese comandate",
  "In repair": "În reparație",
  Testing: "Testare",
  Ready: "Gata",
};

function logPreparedImage(preparedImage: PreparedImage) {
  if (process.env.NODE_ENV !== "development") return;

  const formatSize = (bytes: number) =>
    `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

  console.info(
    `[IMAGE-PREP]\ncontext: work-progress\noriginal: ${preparedImage.originalWidth}x${preparedImage.originalHeight} / ${formatSize(preparedImage.originalSize)}\nfinal: ${preparedImage.width}x${preparedImage.height} / ${formatSize(preparedImage.finalSize)}\ntargetSizeMet: ${preparedImage.targetSizeMet}`,
  );
}

export default function WonJobDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [selectedStatus, setSelectedStatus] = useState("");
  const [message, setMessage] = useState("");
  const [progressImages, setProgressImages] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedPreviewUrls, setUploadedPreviewUrls] = useState<string[]>([]);
  const uploadedPreviewUrlsRef = useRef<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [serviceType, setServiceType] = useState<"bodywork" | "mechanical">(
    "bodywork",
  );

  useEffect(() => {
    const loadRequestStatus = async () => {
      const { data: requestData } = await supabase
        .from("repair_requests")
        .select("status, service_type")
        .eq("id", requestId)
        .maybeSingle();

      const { data: latestProgress } = await supabase
        .from("work_progress_updates")
        .select("status")
        .eq("request_id", requestId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestProgress?.status) {
        setSelectedStatus(latestProgress.status);
      } else if (requestData?.status) {
        setSelectedStatus(requestData.status);
      }

      if (requestData?.service_type === "mechanical") {
        setServiceType("mechanical");
      }
    };

    if (requestId) {
      loadRequestStatus();
    }
  }, [requestId]);

  useEffect(() => {
    return () => {
      uploadedPreviewUrlsRef.current.forEach((url) =>
        URL.revokeObjectURL(url),
      );
    };
  }, []);

  const activeProgressSteps =
    serviceType === "mechanical"
      ? mechanicalProgressSteps
      : bodyworkProgressSteps;

  const handleImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);
    const previews = files.map((file) => URL.createObjectURL(file));

    setProgressImages((current) => [...current, ...files]);
    setUploadedPreviewUrls((current) => {
      const next = [...current, ...previews];
      uploadedPreviewUrlsRef.current = next;
      return next;
    });
    e.target.value = "";
  };

  const removeProgressImage = (index: number) => {
    const previewUrl = uploadedPreviewUrlsRef.current[index];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setProgressImages((current) =>
      current.filter((_, imageIndex) => imageIndex !== index),
    );
    setUploadedPreviewUrls((current) => {
      const next = current.filter((_, imageIndex) => imageIndex !== index);
      uploadedPreviewUrlsRef.current = next;
      return next;
    });
  };

  const uploadProgressImages = async () => {
    try {
      setUploading(true);
      setSuccessMessage("");

      const preparedImages: PreparedImage[] = [];

      // Prepare every image before uploading any of them.
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

        if (uploadError) {
          console.error(uploadError);
          continue;
        }

        const { data } = supabase.storage
          .from("work-progress")
          .getPublicUrl(filePath);

        uploadedUrls.push(data.publicUrl);
      }

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Not authenticated");
        return;
      }

      const { error: insertError } = await supabase
        .from("work_progress_updates")
        .insert({
          request_id: requestId,

          sender_id: authData.user.id,

          sender_role: "workshop",

          status: selectedStatus,

          message,

          images: uploadedUrls,
        });

      if (insertError) {
        console.error(insertError);

        alert("Nu am putut salva update-ul.");

        return;
      }

      const requestStatus =
        selectedStatus === "Ready" || selectedStatus === "Gata"
          ? "completed"
          : "in_progress";

      await supabase
        .from("repair_requests")
        .update({
          status: requestStatus,
        })
        .eq("id", requestId);

      const { data: verifyData } = await supabase
        .from("repair_requests")
        .select("status")
        .eq("id", requestId)
        .single();

      console.log("REQUEST STATUS =", verifyData);

      console.log("Uploaded:", uploadedUrls);

      setSuccessMessage("success");

      setTimeout(() => {
        setSuccessMessage("");
      }, 5000);

      setSuccessMessage("Update trimis către client.");
      setMessage("");
      setProgressImages([]);
      uploadedPreviewUrlsRef.current.forEach((url) =>
        URL.revokeObjectURL(url),
      );
      uploadedPreviewUrlsRef.current = [];
      setUploadedPreviewUrls([]);

      setMessage("");
      setProgressImages([]);
      setUploadedPreviewUrls([]);
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Nu am putut pregăti imaginile pentru upload.",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-5xl">
        <button
          onClick={() => router.push("/workshops/won-jobs")}
          className="mb-6 rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          ← Înapoi
        </button>

        <p className="text-sm uppercase tracking-[0.25em] text-orange-400">
          Work progress
        </p>

        <h1 className="mt-2 text-3xl font-bold">Detalii lucrare</h1>

        <div className="mt-6 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <p className="text-sm text-white/50">Lucrare</p>
            <p className="mt-2 break-all font-mono text-xs text-white/80">
              {requestId}
            </p>

            <div className="mt-6 rounded-3xl bg-white p-5 text-black">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-orange-500">
                Current status
              </p>
              <h2 className="mt-2 text-2xl font-black">
                {statusLabels[selectedStatus] ?? selectedStatus}
              </h2>
              <p className="mt-2 text-sm text-black/60">
                Clientul va vedea progresul lucrării și pozele încărcate de
                service.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              {activeProgressSteps.map((step, index) => {
                const activeIndex = activeProgressSteps.indexOf(selectedStatus);
                const done = index <= activeIndex;

                return (
                  <div key={step} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                          done
                            ? "bg-orange-500 text-black"
                            : "bg-white/10 text-white/40"
                        }`}
                      >
                        {done ? "✓" : index + 1}
                      </div>

                      {index < activeProgressSteps.length - 1 && (
                        <div
                          className={`h-8 w-px ${
                            done ? "bg-orange-500" : "bg-white/10"
                          }`}
                        />
                      )}
                    </div>

                    <div>
                      <p className="font-semibold">
                        {statusLabels[step] ?? step}
                      </p>
                      <p className="text-sm text-white/45">
                        {done ? "Completed / active" : "Waiting"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <h2 className="text-xl font-bold">Upload progres</h2>
            <p className="mt-2 text-sm text-white/50">
              Trimite clientului status, mesaj și poze din atelier.
            </p>

            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="mt-5 w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none"
            >
              {activeProgressSteps.map((step) => (
                <option key={step} value={step}>
                  {statusLabels[step] ?? step}
                </option>
              ))}
            </select>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                serviceType === "mechanical"
                  ? "Ex: Am făcut diagnoza, am comandat piesele..."
                  : "Ex: Bara spate este pregătită pentru vopsit..."
              }
              className="mt-4 min-h-[120px] w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-sm text-white outline-none"
            />

            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-white/20 bg-black/40 px-4 py-8 text-center hover:bg-white/5">
              <span className="text-3xl">📸</span>
              <span className="mt-2 text-sm font-semibold">
                Adaugă poze progres
              </span>
              <span className="mt-1 text-xs text-white/40">
                În curând conectăm upload real Supabase
              </span>
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImages}
                className="hidden"
              />
            </label>

            {uploadedPreviewUrls.length > 0 && (
              <div className="mt-4">
                <ImageGallery
                  images={uploadedPreviewUrls.map((url, index) => ({
                    name: `progress-preview-${index}`,
                    url,
                  }))}
                  alt="Poze progres"
                  className="h-48 w-full object-cover"
                  wrapperClassName="block w-full overflow-hidden rounded-2xl"
                />

                <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {uploadedPreviewUrls.map((url, index) => (
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
                        className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/80 text-sm font-bold text-white"
                        aria-label={`Șterge imaginea ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {successMessage && (
              <div className="mt-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-300">✓</span>
                  <p className="text-sm font-semibold text-emerald-300">
                    Update trimis cu succes
                  </p>
                </div>

                <p className="mt-1 text-xs text-white/50">
                  Clientul vede acum statusul, mesajul și pozele trimise.
                </p>
              </div>
            )}

            <button
              onClick={uploadProgressImages}
              disabled={uploading || !selectedStatus}
              className="mt-5 w-full rounded-2xl bg-orange-500 px-5 py-4 text-sm font-black text-black hover:bg-orange-400 disabled:opacity-50"
            >
              {uploading ? "Se încarcă..." : "Trimite update către client"}
            </button>
          </section>
        </div>
      </div>
    </main>
  );
}
