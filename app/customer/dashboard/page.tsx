"use client";

import { useRouter } from "next/navigation";

export default function CustomerDashboardPage() {
  const router = useRouter();

  return (
    <main className="h-[calc(100dvh-86px)] overflow-hidden bg-[#101010] px-4 py-2 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mt-10 grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push("/post-job")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              +
            </div>
            <h2 className="text-base font-bold leading-tight">Postează</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Încarcă poze și descriere
            </p>
          </button>

          <button
            onClick={() => router.push("/workshops")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              €
            </div>
            <h2 className="text-base font-bold leading-tight">
              Daune disponibile
            </h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Vezi cererile clienților
            </p>
          </button>

          <button
            onClick={() => router.push("/customer/my-jobs")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              ✓
            </div>
            <h2 className="text-base font-bold leading-tight">Programări</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Lucrări programate
            </p>
          </button>
        </div>
      </div>
    </main>
  );
}
