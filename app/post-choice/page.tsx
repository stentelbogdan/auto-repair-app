"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Car3DViewer from "../components/car-3d/Car3DViewer";

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
    <main className="h-[calc(100svh-236px)] overflow-hidden bg-black px-5 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 text-white">
      <div className="mx-auto flex h-full max-w-md flex-col md:max-w-5xl">
        <section className="shrink-0 text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            POSTEAZĂ CERERE
          </p>
        </section>

        <section className="mt-4 shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-[#17191d] shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <Car3DViewer
            mode="preview"
            heightClassName="h-[125px] [@media(min-height:700px)]:h-[clamp(200px,27svh,280px)]"
          />
        </section>

        <section className="mt-10 grid shrink-0 grid-cols-2 gap-3 md:mx-auto md:mt-8 md:max-w-3xl md:gap-6">
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

          <div className="col-span-2 mx-auto w-[calc(50%_-_6px)] md:w-[calc(50%_-_12px)]">
            <Card
              title="Roți"
              desc="Anvelope + jante"
              icon="🛞"
              onClick={() => router.push(`/post-wheels${query}`)}
            />
          </div>
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
      type="button"
      onClick={onClick}
      className="relative w-full rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 active:scale-[0.98] hover:scale-[1.02] md:p-6 md:hover:shadow-2xl"
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
