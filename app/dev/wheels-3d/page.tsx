"use client";

import WheelsRequestForm from "@/app/components/wheels/WheelsRequestForm";

export default function Wheels3DTestPage() {
  return (
    <main className="min-h-screen bg-black px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-400">
          Test izolat
        </p>
        <h1 className="mt-2 text-3xl font-black">Selector roți 3D</h1>
        <p className="mt-2 text-sm leading-6 text-white/60">
          Rotește mașina și selectează una sau mai multe roți.
        </p>

        <div className="mt-6">
          <WheelsRequestForm />
        </div>
      </div>
    </main>
  );
}
