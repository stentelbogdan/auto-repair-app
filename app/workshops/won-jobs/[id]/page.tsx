"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import ImageGallery from "@/app/components/ImageGallery";

const bodyworkProgressSteps = [
  "Received",
  "Disassembly",
  "Body repair",
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
  Painting: "Vopsire",
  Polishing: "Polish",
  Diagnosis: "Diagnoză",
  "Parts ordered": "Piese comandate",
  "In repair": "În reparație",
  Testing: "Testare",
  Ready: "Gata",
};

export default function WonJobDetailPage() {
  const params = useParams();
  const router = useRouter();

  const requestId = params.id as string;

  const [selectedStatus, setSelectedStatus] = useState("");
  const [message, setMessage] = useState("");
  const [progressImages, setProgressImages] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadedPreviewUrls, setUploadedPreviewUrls] = useState<string[]>([]);
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

  const activeProgressSteps =
    serviceType === "mechanical"
      ? mechanicalProgressSteps
      : bodyworkProgressSteps;

  const handleImages = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const files = Array.from(e.target.files);

    setProgressImages(files);

    const previews = files.map((file) => URL.createObjectURL(file));

    setUploadedPreviewUrls(previews);
  };

  const uploadProgressImages = async () => {
    try {
      setUploading(true);
      setSuccessMessage("");

      const uploadedUrls: string[] = [];

      for (const file of progressImages) {
        const filePath = `${requestId}/${Date.now()}-${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from("work-progress")
          .upload(filePath, file);

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
      setUploadedPreviewUrls([]);

      setMessage("");
      setProgressImages([]);
      setUploadedPreviewUrls([]);
    } catch (error) {
      console.error(error);
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
              <div className="mt-4 overflow-hidden rounded-2xl">
                <ImageGallery
                  images={uploadedPreviewUrls.map((url, index) => ({
                    name: `progress-preview-${index}`,
                    url,
                  }))}
                  alt="Poze progres"
                  className="h-48 w-full object-cover"
                  wrapperClassName="block w-full overflow-hidden rounded-2xl"
                />
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