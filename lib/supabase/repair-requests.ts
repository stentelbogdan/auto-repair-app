import { supabase } from "@/lib/supabase/client";

export type RepairRequestRow = {
  id: string;
  user_id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  damage_type: string;
  description: string | null;
  images: {
  name: string;
  url?: string;
  dataUrl?: string;
}[];
  status: string;
  accepted_offer_id: string | null;
  created_at: string;
};

export async function createRepairRequest(input: {
  userId: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  description: string;
  images: {
  name: string;
  url?: string;
  dataUrl?: string;
}[];
}) {
  const { data, error } = await supabase
    .from("repair_requests")
    .insert({
      user_id: input.userId,
      car_brand: input.carBrand,
      car_model: input.carModel,
      car_year: input.carYear,
      city: input.city,
      damage_type: input.damageType,
      description: input.description,
      images: input.images,
      status: "open",
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as RepairRequestRow;
}

export async function getWorkshopRepairRequests() {
  const { data, error } = await supabase
    .from("repair_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as RepairRequestRow[];
}

export async function getOwnRepairRequests(userId: string) {
  const { data, error } = await supabase
    .from("repair_requests")
    .select(
      "id, user_id, car_brand, car_model, car_year, city, damage_type, description, status, accepted_offer_id, created_at, images"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []) as RepairRequestRow[];
}