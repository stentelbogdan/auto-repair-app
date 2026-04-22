"use client";

import { useRouter } from "next/navigation";

export default function SuccessPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-black text-white px-6 py-10 flex items-center justify-center">
      <div className="w-full max-w-2xl rounded-2xl border border-green-500/20 bg-green-500/10 p-8 text-center">
        <h1 className="text-4xl font-bold">Request sent</h1>
        <p className="mt-3 text-white/70">
          Your repair request has been sent to workshops. You will receive offers soon.
        </p>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:justify-center">
          <button
            onClick={() => router.push("/workshops")}
            className="rounded-lg bg-white px-6 py-3 font-semibold text-black"
          >
            View workshop dashboard
          </button>

          <button
            onClick={() => router.push("/offers")}
            className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
        >
            View customer offers
            </button>

          <button
            onClick={() => {
              localStorage.removeItem("repairRequest");
              router.push("/");
            }}
            className="rounded-lg border border-white/20 px-6 py-3 font-semibold text-white"
          >
            Create another request
          </button>
        </div>
      </div>
    </main>
  );
}