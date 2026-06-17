"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

export default function WorkshopProfileActions({
  workshopId,
}: {
  workshopId: string;
}) {
  const router = useRouter();

  const handleRequestOffer = () => {
  router.push(`/post-job?targetWorkshopId=${workshopId}`);
};

  const handleSendMessage = async () => {
    const { data: authData } = await supabase.auth.getUser();

    if (!authData.user) {
      router.push("/login");
      return;
    }

    const { data: existingRequest } = await supabase
      .from("repair_requests")
      .select("id")
      .eq("user_id", authData.user.id)
      .eq("target_workshop_id", workshopId)
      .eq("request_type", "direct_message")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingRequest?.id) {
      router.push(`/chat/${existingRequest.id}?role=customer`);
      return;
    }

    const { data: request, error } = await supabase
      .from("repair_requests")
      .insert({
        user_id: authData.user.id,
        status: "open",
        request_type: "direct_message",
        target_workshop_id: workshopId,
        car_brand: "Mesaj direct",
        car_model: "Service",
        car_year: new Date().getFullYear(),
        damage_type: "direct_message",
        city: "-",
        description: "Conversație începută din profilul service-ului.",
        images: [],
      })
      .select("id")
      .single();

    if (error || !request?.id) {
      alert(error?.message || "Nu am putut porni conversația.");
      return;
    }

    router.push(`/chat/${request.id}?role=customer`);
  };

  return (
    <div className="mt-8 flex flex-col gap-3 md:flex-row">
      <button
        type="button"
        onClick={handleRequestOffer}
        className="flex-1 rounded-2xl bg-orange-500 px-6 py-4 text-base font-black text-black transition hover:bg-orange-400"
      >
        Solicită ofertă
      </button>

      <button
        type="button"
        onClick={handleSendMessage}
        className="flex-1 rounded-2xl border border-white/20 bg-white/5 px-6 py-4 text-base font-bold text-white transition hover:bg-white/10"
      >
        Trimite mesaj
      </button>
    </div>
  );
}
