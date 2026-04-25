"use client";

import { useRouter } from "next/navigation";

export default function CustomerDashboardPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#101010] px-5 py-6 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 rounded-[28px] bg-black px-6 py-6 shadow-2xl">
          <p className="text-sm uppercase tracking-[0.25em] text-orange-400">
            Customer dashboard
          </p>
          <h1 className="mt-3 text-3xl font-bold">AutoRepair Marketplace</h1>
          <p className="mt-2 text-white/60">
            Manage your repair requests, offers and accepted jobs.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <button
            onClick={() => router.push("/post-job")}
            className="rounded-[26px] bg-white p-6 text-left text-black shadow-xl transition hover:scale-[1.01]"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
              +
            </div>
            <h2 className="text-2xl font-bold">Post a repair job</h2>
            <p className="mt-2 text-sm text-black/60">
              Upload photos and describe the damage.
            </p>
          </button>

          <button
            onClick={() => router.push("/offers")}
            className="rounded-[26px] bg-white p-6 text-left text-black shadow-xl transition hover:scale-[1.01]"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
              €
            </div>
            <h2 className="text-2xl font-bold">My offers</h2>
            <p className="mt-2 text-sm text-black/60">
              Compare workshop prices and accept the best offer.
            </p>
          </button>

          <button
            onClick={() => router.push("/offers")}
            className="rounded-[26px] bg-white p-6 text-left text-black shadow-xl transition hover:scale-[1.01]"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
              ✓
            </div>
            <h2 className="text-2xl font-bold">Accepted jobs</h2>
            <p className="mt-2 text-sm text-black/60">
              View repairs that are already booked.
            </p>
          </button>

          <button
            onClick={() => router.push("/account")}
            className="rounded-[26px] bg-white p-6 text-left text-black shadow-xl transition hover:scale-[1.01]"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-100 text-3xl">
              ⚙
            </div>
            <h2 className="text-2xl font-bold">Account</h2>
            <p className="mt-2 text-sm text-black/60">
              Manage your account and role access.
            </p>
          </button>
        </div>
      </div>
    </main>
  );
}