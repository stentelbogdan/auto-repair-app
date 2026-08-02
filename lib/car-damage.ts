import type {
  RepairServiceDetails,
  StructuredServiceDetails,
} from "@/lib/supabase/repair-requests";

export function isStructuredServiceDetails(
  serviceDetails: RepairServiceDetails | null | undefined,
): serviceDetails is StructuredServiceDetails {
  if (!serviceDetails || Array.isArray(serviceDetails)) {
    return false;
  }

  const { version, selectedServices, carDamage, options } = serviceDetails;

  return (
    version === 1 &&
    Array.isArray(selectedServices) &&
    Boolean(carDamage) &&
    Array.isArray(carDamage.parts) &&
    Array.isArray(carDamage.damages) &&
    Array.isArray(options)
  );
}

export function getSelectedParts(
  serviceDetails: RepairServiceDetails | null | undefined,
): string[] {
  if (!isStructuredServiceDetails(serviceDetails)) {
    return [];
  }

  return serviceDetails.carDamage.parts;
}

export function getSelectedDamages(
  serviceDetails: RepairServiceDetails | null | undefined,
): string[] {
  if (!isStructuredServiceDetails(serviceDetails)) {
    return [];
  }

  return serviceDetails.carDamage.damages;
}

export function getAffectedPartLabels(
  serviceDetails: RepairServiceDetails | null | undefined,
): string[] {
  return getSelectedParts(serviceDetails).map(formatCarPartLabel);
}

export function getDamageTypeLabels(
  serviceDetails: RepairServiceDetails | null | undefined,
): string[] {
  return getSelectedDamages(serviceDetails).map(formatDamageLabel);
}

export function formatCarPartLabel(value: string): string {
  const labels: Record<string, string> = {
    hood: "Capotă",
    front_bumper: "Bară față",
    rear_bumper: "Bară spate",

    left_front_fender: "Aripă față stânga",
    right_front_fender: "Aripă față dreapta",
    left_rear_quarter: "Aripă spate stânga",
    right_rear_quarter: "Aripă spate dreapta",

    left_front_door: "Ușă față stânga",
    right_front_door: "Ușă față dreapta",
    left_rear_door: "Ușă spate stânga",
    right_rear_door: "Ușă spate dreapta",

    left_sill: "Prag stânga",
    right_sill: "Prag dreapta",

    roof: "Plafon",
    panoramic_roof: "Plafon panoramic",
    tailgate: "Hayon",
    trunk: "Portbagaj",

    windscreen: "Parbriz",
    rear_window: "Lunetă",

    left_mirror: "Oglindă stânga",
    right_mirror: "Oglindă dreapta",

    front_grille: "Grilă față",

    front_light_left: "Far față stânga",
    front_light_right: "Far față dreapta",
    rear_light_left: "Stop spate stânga",
    rear_light_right: "Stop spate dreapta",
    rear_lights: "Stopuri spate",

    front_left_wheel: "Roată față stânga",
    front_right_wheel: "Roată față dreapta",
    rear_left_wheel: "Roată spate stânga",
    rear_right_wheel: "Roată spate dreapta",
  };

  return labels[value] ?? formatFallbackLabel(value);
}

export function formatDamageLabel(value: string): string {
  const labels: Record<string, string> = {
    scratch: "Zgârietură",
    dent: "Îndoitură",
    cracked: "Crăpătură",
    broken: "Element spart",
    deformed: "Element deformat",
    painting: "Necesită vopsire",
    paint_damage: "Vopsea deteriorată",
    paint_peeling: "Vopsea exfoliată",
    rust: "Rugină",
  };

  return labels[value] ?? formatFallbackLabel(value);
}

function formatFallbackLabel(value: string): string {
  const normalized = value.replaceAll("_", " ").trim();

  if (!normalized) {
    return value;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
