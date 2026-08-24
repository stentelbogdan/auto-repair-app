export const damageTypeLabels: Record<string, string> = {
  scratch: "Zgârietură",
  dent: "Îndoitură",
  detailing_interior: "Detailing interior",
  detailing_exterior: "Detailing exterior",
  polish: "Polish",
  ceramic_coating: "Protecție ceramică",
  ppf: "Folie PPF",
  wrap: "Colantare",
  window_tint: "Folii geamuri",
  dechroming: "Dechroming",
  wheel_refurbishment: "Recondiționare jante",
  smart_repair: "Smart Repair",
  pdr: "Îndreptare fără vopsire",
  engine: "Motor",
  gearbox: "Cutie de viteze",
  brakes: "Frâne",
  suspension: "Suspensie",
  steering: "Direcție",
  electrical: "Electrică",
  ac: "Aer condiționat",
  diagnostic: "Diagnoză",
  service: "Revizie",
  other: "Alt tip de problemă",
  bumper: "Bară",
  paint: "Vopsitorie",
  cracked_part: "Element crăpat",
  cosmetic: "Daună estetică",
  mechanical: "Problemă mecanică",
  wheels: "Roți și anvelope",
  detailing: "Detailing",
  body: "Caroserie",
  bodywork: "Caroserie",
  // Legacy aliases used by older request records.
  ceramic: "Protecție ceramică",
  wrapping: "Colantare",
};

export const detailedDamageTypeLabels: Record<string, string> = {
  scratch: "Zgârietură",
  dent: "Îndoitură",
  crack: "Crăpătură",
  broken: "Element spart",
  deformed: "Element deformat",
  paint_damage: "Vopsea deteriorată",
  paint_peeling: "Vopsea exfoliată",
  rust: "Rugină / Coroziune",
  stone_chips: "Ciobituri de pietre",
  replacement: "Necesită înlocuire",
  painting: "Necesită vopsire",
  other: "Alt tip de daună",
};

export const serviceTypeLabels: Record<string, string> = {
  bodywork: "Caroserie",
  mechanical: "Mecanică",
  wheels: "Roți și anvelope",
};

export const statusLabels: Record<string, string> = {
  open: "Deschisă",
  matched: "Acceptată",
  requested: "Programare propusă",
  confirmed: "Programare confirmată",
  declined: "Respinsă",
  cancelled: "Anulată",
  pending: "În așteptare",
  accepted: "Acceptată",
  rejected: "Respinsă",
  in_progress: "În lucru",
  completed: "Finalizată",
};

export const categoryLabels: Record<string, string> = {
  detailing_interior: "Detailing interior",
  detailing_exterior: "Detailing exterior",
  polish: "Polish profesional",
  ceramic: "Protecție ceramică",
  ppf: "Folie PPF",
  wrapping: "Colantare",
  window_tint: "Folii geamuri",
  dechroming: "Dechroming",
  wheel_refurbishment: "Recondiționare jante",
  smart_repair: "Smart Repair",
  pdr: "Îndreptare fără vopsire",
};

function fallbackLabel(value?: string | null) {
  if (!value) return "";

  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getDamageTypeLabel(value?: string | null) {
  if (!value || value === "direct_message") return "";
  return damageTypeLabels[value] || fallbackLabel(value);
}

export function getDetailedDamageTypeLabel(value?: string | null) {
  if (!value) return "";
  return detailedDamageTypeLabels[value] || fallbackLabel(value);
}

export function getServiceTypeLabel(value?: string | null) {
  if (!value) return "";
  return serviceTypeLabels[value] || fallbackLabel(value);
}

export function getRequestTypeBadgeLabel(serviceType?: string | null) {
  if (!serviceType || serviceType === "bodywork") return "Daună estetică";
  if (serviceType === "mechanical") return "Problemă mecanică";
  if (serviceType === "wheels") return "Roți și anvelope";
  return "Tip cerere";
}

export function getStatusLabel(value?: string | null) {
  if (!value) return "";
  return statusLabels[value] || fallbackLabel(value);
}

export function getCategoryLabel(value?: string | null) {
  if (!value) return "";
  return categoryLabels[value] || fallbackLabel(value);
}
