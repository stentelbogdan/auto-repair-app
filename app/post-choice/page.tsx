"use client";

import { useRouter } from "next/navigation";

export default function PostChoicePage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white">
      <div className="mx-auto max-w-3xl">
        <button
          onClick={() => router.back()}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70"
        >
          ← Înapoi
        </button>

        <p className="text-xs uppercase tracking-[0.28em] text-orange-400">
          Postează cerere
        </p>

        <h1 className="mt-3 text-4xl font-black leading-tight">
          Ce problemă vrei să postezi?
        </h1>

        <p className="mt-3 text-white/50">
          Alege categoria potrivită ca să primești oferte de la service-uri
          specializate.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <button
            onClick={() => router.push("/post-job")}
            className="rounded-[32px] bg-white p-6 text-left text-black shadow-xl transition active:scale-[0.98]"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-100 text-3xl">
              🚗
            </div>

            <h2 className="mt-6 text-2xl font-black">Daună estetică</h2>

            <p className="mt-2 text-sm leading-6 text-black/55">
              Lovituri, zgârieturi, vopsitorie, detailing, polish, PDR, jante,
              colantări sau alte lucrări vizibile.
            </p>

            <div className="mt-6 rounded-full bg-black px-5 py-3 text-center text-sm font-bold text-white">
              Postează daună estetică
            </div>
          </button>

          <button
            onClick={() => router.push("/post-mechanical")}
            className="rounded-[32px] bg-white p-6 text-left text-black shadow-xl transition active:scale-[0.98]"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-orange-100 text-3xl">
              ⚙️
            </div>

            <h2 className="mt-6 text-2xl font-black">Problemă mecanică</h2>

            <p className="mt-2 text-sm leading-6 text-black/70">
              Motor, cutie viteze, frâne, suspensie, diagnoză, AC, electrică,
              revizie sau alte probleme tehnice.
            </p>

            <div className="mt-6 rounded-full bg-black px-5 py-3 text-center text-sm font-bold text-white">
              Postează problemă mecanică
            </div>
          </button>
        </div>
      </div>
    </main>
  );
}
