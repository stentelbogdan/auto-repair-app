"use client";

import { Suspense, useEffect } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getMechanicalCategory } from "@/lib/mechanical/mechanical-categories";
import { useMechanicalDraft } from "../MechanicalDraftProvider";

export default function MechanicalSymptomsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
          <p className="text-sm text-white/65">Se încarcă...</p>
        </main>
      }
    >
      <MechanicalSymptomsContent />
    </Suspense>
  );
}

function MechanicalSymptomsContent() {
  const params = useParams<{ category: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = getMechanicalCategory(params.category);
  const targetWorkshopId = searchParams.get("targetWorkshopId");
  const { draft, isHydrated, updateDraft, toggleSymptom } =
    useMechanicalDraft();
  const returnQuery = targetWorkshopId
    ? `?targetWorkshopId=${encodeURIComponent(targetWorkshopId)}`
    : "";
  const returnUrl = `/post-mechanical${returnQuery}`;

  useEffect(() => {
    if (category) return;
    router.replace(returnUrl);
  }, [category, returnUrl, router]);

  useEffect(() => {
    if (!isHydrated || !category) return;

    updateDraft({
      category: category.id,
      targetWorkshopId,
    });
  }, [category, isHydrated, targetWorkshopId, updateDraft]);

  if (!category || !isHydrated) {
    return (
      <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
        <p className="text-sm text-white/65">Se încarcă...</p>
      </main>
    );
  }

  const selectedSymptoms = draft.symptomIdsByCategory[category.id] ?? [];

  const returnToForm = () => {
    router.replace(returnUrl);
  };

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-5 text-white">
      <div className="mx-auto max-w-2xl">
        <button
          type="button"
          onClick={returnToForm}
          className="inline-flex min-h-12 items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 transition hover:bg-white/10"
        >
          <ChevronLeft size={18} />
          Înapoi
        </button>

        <header className="mt-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/15 text-3xl">
            {category.icon}
          </div>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.25em] text-orange-400">
            Problemă mecanică
          </p>
          <h1 className="mt-2 text-3xl font-black">{category.label}</h1>
          <p className="mt-3 text-sm leading-6 text-white/60">
            Selectează simptomele pe care le-ai observat. Poți alege mai multe
            opțiuni.
          </p>
        </header>

        <section className="mt-6 space-y-3" aria-label="Simptome disponibile">
          {category.symptoms.map((symptom) => {
            const selected = selectedSymptoms.includes(symptom.id);

            return (
              <button
                key={symptom.id}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleSymptom(category.id, symptom.id)}
                className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-2xl border px-4 py-3 text-left text-base font-semibold transition active:scale-[0.99] ${
                  selected
                    ? "border-orange-400 bg-orange-500/15 text-white shadow-[0_0_24px_rgba(249,115,22,0.12)]"
                    : "border-white/10 bg-white/[0.04] text-white/75 hover:border-white/20 hover:bg-white/[0.07]"
                }`}
              >
                <span>{symptom.label}</span>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                    selected
                      ? "border-orange-400 bg-orange-500 text-black"
                      : "border-white/20 text-transparent"
                  }`}
                  aria-hidden="true"
                >
                  <Check size={16} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </section>

        <div className="sticky bottom-0 z-20 mt-8 border-t border-white/10 bg-[#101010]/95 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={returnToForm}
              className="min-h-12 rounded-2xl border border-white/15 px-4 py-3 font-semibold text-white transition hover:bg-white/10"
            >
              Înapoi
            </button>
            <button
              type="button"
              onClick={returnToForm}
              className="min-h-12 rounded-2xl bg-orange-500 px-4 py-3 font-bold text-black transition hover:bg-orange-400"
            >
              Continuă
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
