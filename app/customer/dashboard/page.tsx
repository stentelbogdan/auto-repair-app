"use client";

import { useRouter } from "next/navigation";

export default function CustomerDashboardPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#111111] px-4 py-5 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 rounded-[24px] bg-black px-5 py-5 shadow-xl">
          <p className="text-xs uppercase tracking-[0.25em] text-orange-400">
            Customer dashboard
          </p>
          <h1 className="mt-2 text-2xl font-bold leading-tight">
            AutoRepair Marketplace
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-white/55">
            Manage requests, offers and booked repairs.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => router.push("/post-job")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              +
            </div>
            <h2 className="text-base font-bold leading-tight">Post job</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Upload damage photos
            </p>
          </button>

          <button
            onClick={() => router.push("/offers")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              €
            </div>
            <h2 className="text-base font-bold leading-tight">My offers</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Compare prices
            </p>
          </button>

          <button
            onClick={() => router.push("/offers")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
              ✓
            </div>
            <h2 className="text-base font-bold leading-tight">Booked</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Accepted repairs
            </p>
          </button>

          <button
            onClick={() => router.push("/account")}
            className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
          >
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-xl">
              ⚙
            </div>
            <h2 className="text-base font-bold leading-tight">Account</h2>
            <p className="mt-1 text-xs leading-snug text-black/55">
              Profile & access
            </p>
          </button>
        </div>
      </div>
    </main>
  );
}