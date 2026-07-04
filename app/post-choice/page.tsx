"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function PostChoicePage() {
  return (
    <Suspense fallback={null}>
      <PostChoiceContent />
    </Suspense>
  );
}

function PostChoiceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const targetWorkshopId = searchParams.get("targetWorkshopId");
  const query = targetWorkshopId ? `?targetWorkshopId=${targetWorkshopId}` : "";

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-md md:max-w-5xl">
        <button
          onClick={() => router.back()}
          className="mb-6 rounded-full border border-white/15 px-4 py-2 text-sm text-white/70"
        >
          ← Înapoi
        </button>

        <section className="mb-5 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            POSTEAZĂ CERERE
          </p>
        </section>

        <section className="mt-10 grid grid-cols-2 gap-3 md:mx-auto md:max-w-3xl md:gap-6">
          <Card
            title="Daună estetică"
            desc="Poze + descriere"
            icon="🚗"
            onClick={() => router.push(`/post-job${query}`)}
          />

          <Card
            title="Problemă mecanică"
            desc="Descrie problema"
            icon="⚙️"
            onClick={() => router.push(`/post-mechanical${query}`)}
          />
        </section>
      </div>
    </main>
  );
}

function Card({
  title,
  desc,
  icon,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="relative rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 active:scale-[0.98] hover:scale-[1.02] md:hover:shadow-2xl md:p-6"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold md:h-14 md:w-14 md:text-3xl">
        {icon}
      </div>

      <h2 className="text-base font-bold leading-tight md:text-lg">{title}</h2>

      <p className="mt-1 text-xs leading-snug text-black/55 md:text-sm">
        {desc}
      </p>
    </button>
  );
}