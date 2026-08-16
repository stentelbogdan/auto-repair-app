"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { saveWorkProgressUpdate } from "@/lib/supabase/work-progress";
import {
  formatProgressStatus,
  getProgressWorkflow,
  isProgressStatusValidForWorkflow,
  normalizeProgressStatus,
  type ProgressServiceType,
  type ProgressStatus,
} from "@/lib/work-progress/workflows";

type RequestSummary = {
  car_brand: string | null;
  car_model: string | null;
  service_type: string | null;
};

export default function WorkStatusPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const requestId = params.id;
  const savingRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<RequestSummary | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [serviceType, setServiceType] =
    useState<ProgressServiceType>("bodywork");
  const [activeStatus, setActiveStatus] = useState<ProgressStatus | null>(null);
  const [savingStatus, setSavingStatus] = useState<ProgressStatus | null>(null);
  const [workflowBlocked, setWorkflowBlocked] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error" | "info";
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
            .select("car_brand, car_model, status, service_type")
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
        const resolvedServiceType: ProgressServiceType =
          requestResult.data.service_type === "mechanical"
            ? "mechanical"
            : "bodywork";
        setServiceType(resolvedServiceType);

        if (progressResult.data?.status) {
          if (
            isProgressStatusValidForWorkflow(
              progressResult.data.status,
              resolvedServiceType,
            )
          ) {
            setActiveStatus(
              normalizeProgressStatus(progressResult.data.status),
            );
          } else {
            setWorkflowBlocked(true);
            setFeedback({
              type: "error",
              message: `Statusul curent „${formatProgressStatus(progressResult.data.status)}” nu este compatibil cu workflow-ul ${resolvedServiceType === "mechanical" ? "mecanic" : "de caroserie"}. Etapa nu poate fi schimbată până la clarificarea datelor.`,
            });
          }
        } else if (requestResult.data.status === "completed") {
          setActiveStatus("Ready");
        }
      } catch (error) {
        if (!active) return;

        setFeedback({
          type: "error",
          message:
            error instanceof Error
              ? error.message
              : "Stadiul lucrării nu a putut fi încărcat.",
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

  const changeStatus = async (status: ProgressStatus) => {
    if (savingRef.current || workflowBlocked) return;

    if (status === activeStatus) {
      setFeedback({
        type: "info",
        message: `${formatProgressStatus(status)} este deja etapa activă.`,
      });
      return;
    }

    if (!userId) {
      setFeedback({
        type: "error",
        message: "Utilizatorul autentificat nu a fost găsit.",
      });
      return;
    }

    savingRef.current = true;
    setSavingStatus(status);
    setFeedback(null);

    try {
      await saveWorkProgressUpdate({
        requestId,
        senderId: userId,
        status,
        message: "",
        images: [],
      });

      setActiveStatus(status);
      setFeedback({
        type: "success",
        message: `Etapa a fost schimbată în „${formatProgressStatus(status)}”.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Etapa nu a putut fi salvată.",
      });
    } finally {
      savingRef.current = false;
      setSavingStatus(null);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă stadiul lucrării...
      </main>
    );
  }

  const progressSteps = getProgressWorkflow(serviceType);
  const activeIndex = activeStatus
    ? progressSteps.findIndex((step) => step.status === activeStatus)
    : -1;
  const title = request
    ? `${request.car_brand || "Mașină"} ${request.car_model || ""}`.trim()
    : "Lucrare";

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={() => router.push(`/workshops/in-workshop/${requestId}`)}
          className="mb-6 rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 hover:bg-white/10"
        >
          ← Înapoi
        </button>

        <p className="text-sm uppercase tracking-[0.25em] text-orange-400">
          Stadiu lucrare
        </p>
        <h1 className="mt-2 text-3xl font-bold">{title}</h1>
        <p className="mt-2 text-sm text-white/50">
          Apasă etapa în care se află acum lucrarea. Schimbarea se salvează
          imediat.
        </p>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="space-y-4">
            {progressSteps.map((step, index) => {
              const done = index <= activeIndex;
              const isActive = step.status === activeStatus;
              const isSaving = step.status === savingStatus;

              return (
                <button
                  key={step.status}
                  type="button"
                  disabled={savingStatus !== null || workflowBlocked}
                  onClick={() => void changeStatus(step.status)}
                  aria-pressed={isActive}
                  className={`flex w-full gap-4 rounded-2xl p-3 text-left transition disabled:cursor-wait ${
                    isActive
                      ? "bg-orange-500/10 ring-1 ring-orange-400/70"
                      : "hover:bg-white/[0.05]"
                  }`}
                >
                  <div className="flex flex-col items-center">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold transition ${
                        done
                          ? "bg-orange-500 text-black"
                          : "bg-white/10 text-white/40"
                      } ${isActive ? "ring-2 ring-orange-200 ring-offset-2 ring-offset-black" : ""}`}
                    >
                      {isSaving ? "…" : done ? "✓" : index + 1}
                    </div>

                    {index < progressSteps.length - 1 && (
                      <div
                        className={`h-8 w-px ${
                          done ? "bg-orange-500" : "bg-white/10"
                        }`}
                      />
                    )}
                  </div>

                  <div className="pt-1">
                    <p className="font-semibold">{step.label}</p>
                    <p className="mt-1 text-sm text-white/45">
                      {isSaving
                        ? "Se salvează..."
                        : isActive
                          ? "Etapa activă"
                          : done
                            ? "Parcursă"
                            : "Apasă pentru selectare"}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {feedback && (
            <div
              className={`mt-5 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                feedback.type === "error"
                  ? "border-red-500/25 bg-red-500/10 text-red-300"
                  : feedback.type === "success"
                    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/5 text-white/70"
              }`}
              role={feedback.type === "error" ? "alert" : "status"}
            >
              {feedback.message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
