"use client";

import { FormEvent, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { createRepairOffer } from "@/lib/supabase/repair-offers";

type RepairRequestRow = {
  id: string;
  status: string;
};

type ProfileRow = {
  role: string[] | null;
};

export default function MakeOfferPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [price, setPrice] = useState("");
  const [days, setDays] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosed, setIsClosed] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const loadRequest = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (profileError) {
          console.error("Failed to load profile:", profileError);
          router.push("/");
          return;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        const { data: request, error: requestError } = await supabase
          .from("repair_requests")
          .select("id, status")
          .eq("id", id)
          .single<RepairRequestRow>();

        if (requestError || !request) {
          console.error("Failed to load request:", requestError);
          router.push("/workshops");
          return;
        }

        if (request.status === "matched") {
          setIsClosed(true);
        }
      } catch (error) {
        console.error("Failed to check request status:", error);
        router.push("/workshops");
      } finally {
        setIsLoaded(true);
      }
    };

    loadRequest();
  }, [id, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (isClosed) return;

    setIsSubmitting(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        alert("Please log in first.");
        router.push("/login");
        return;
      }

      const workshopEmail = authData.user.email ?? "Workshop";
      const workshopName = workshopEmail.split("@")[0] || "Workshop";

      await createRepairOffer({
        requestId: id,
        workshopUserId: authData.user.id,
        price,
        days,
        message,
        workshopName,
      });

      router.push("/offers");
    } catch (error: any) {
      console.error("Failed to save offer:", error);
      alert(error?.message || JSON.stringify(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center text-white">
        <p className="text-white/70">Loading...</p>
      </main>
    );
  }

  if (isClosed) {
    return (
      <main className="min-h-screen bg-black px-6 py-10 text-white">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => router.push(`/workshops/${id}`)}
            className="mb-6 rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
          >
            Back
          </button>

          <div className="rounded-2xl border border-green-500/20 bg-green-500/10 p-8 text-center">
            <h1 className="text-3xl font-bold">Offer closed</h1>
            <p className="mt-3 text-white/70">
              This repair request has already been matched with an accepted offer.
            </p>

            <button
              onClick={() => router.push(`/workshops/${id}`)}
              className="mt-6 rounded-lg bg-white px-6 py-3 font-semibold text-black"
            >
              Back to request
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-2xl">
        <button
          onClick={() => router.push(`/workshops/${id}`)}
          className="mb-6 rounded-lg border border-white/20 px-4 py-2 text-sm text-white"
        >
          Back
        </button>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h1 className="text-3xl font-bold md:text-4xl">Send your offer</h1>
          <p className="mt-2 text-white/70">
            Set your price and win this repair job.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label className="mb-2 block text-sm text-white/80">
                Offer price (€)
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="450"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/80">
                Estimated days
              </label>
              <input
                type="number"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="3"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-white/80">
                Message to customer
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="We can repair this damage quickly and professionally."
                rows={5}
                className="w-full rounded-lg border border-white/10 bg-black/30 px-4 py-3 outline-none focus:border-white/30"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-white px-6 py-3 font-semibold text-black disabled:opacity-60"
            >
              {isSubmitting ? "Sending..." : "Send offer"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}