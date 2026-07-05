export const damageTypeLabels: Record<string, string> = {
  scratch: "Zgârietură",
  dent: "Îndoitură",
  crack: "Fisură",
  paint: "Vopsire",
  bumper: "Bară",
  hood: "Capotă",
};

export const serviceTypeLabels: Record<string, string> = {
  bodywork: "Caroserie",
  mechanical: "Mecanică",
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
  if (!value) return "";
  return damageTypeLabels[value] || fallbackLabel(value);
}

export function getServiceTypeLabel(value?: string | null) {
  if (!value) return "";
  return serviceTypeLabels[value] || fallbackLabel(value);
}

export function getStatusLabel(value?: string | null) {
  if (!value) return "";
  return statusLabels[value] || fallbackLabel(value);
}

export function getCategoryLabel(value?: string | null) {
  if (!value) return "";
  return categoryLabels[value] || fallbackLabel(value);
}