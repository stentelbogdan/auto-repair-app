"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useSafeNavigation } from "@/lib/hooks/useSafeNavigation";

export default function PostChoicePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-[calc(100svh-236px)] items-center justify-center bg-black text-white">
          Se încarcă...
        </main>
      }
    >
      <PostChoiceContent />
    </Suspense>
  );
}

function PostChoiceContent() {
  const searchParams = useSearchParams();

  const { navigate, isNavigating } = useSafeNavigation({
    timeoutMs: 2500,
  });

  const targetWorkshopId = searchParams.get("targetWorkshopId");

  const createTargetUrl = (pathname: string) => {
    if (!targetWorkshopId) {
      return pathname;
    }

    const params = new URLSearchParams();
    params.set("targetWorkshopId", targetWorkshopId);

    return `${pathname}?${params.toString()}`;
  };

  const goToBodywork = () => {
    navigate(createTargetUrl("/post-job"));
  };

  const goToMechanical = () => {
    navigate(createTargetUrl("/post-mechanical"));
  };

  const goToWheels = () => {
    navigate(createTargetUrl("/post-wheels"));
  };

  return (
    <main className="relative min-h-[calc(100svh-236px)] overflow-x-hidden bg-black px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-3 text-white">
      <div className="mx-auto max-w-md md:max-w-5xl">
        <section className="text-center">
          <p className="text-[11px] uppercase tracking-[0.26em] text-white/70">
            POSTEAZĂ CERERE
          </p>
        </section>

        <section className="relative z-10 mt-20 grid grid-cols-2 gap-3 md:mx-auto md:w-full md:max-w-3xl md:gap-6">
          <Card
            title="Daună estetică"
            desc="Poze + descriere"
            icon="🚗"
            disabled={isNavigating}
            onClick={goToBodywork}
          />

          <Card
            title="Problemă mecanică"
            desc="Descrie problema"
            icon="⚙️"
            disabled={isNavigating}
            onClick={goToMechanical}
          />

          <div className="col-span-2 mx-auto w-[calc(50%_-_6px)] md:w-[calc(50%_-_12px)]">
            <Card
              title="Roți"
              desc="Anvelope + jante"
              icon="🛞"
              disabled={isNavigating}
              onClick={goToWheels}
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
  disabled = false,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="relative w-full rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 md:p-6 md:hover:scale-[1.02] md:hover:shadow-2xl"
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
