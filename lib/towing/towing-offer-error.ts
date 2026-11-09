// Only fixed, reviewed messages may leave the error object. SQL/PostgREST
// messages can interpolate input values; never log/serialize message/details/hint.
const safeMessages = new Set([
  "Nu am putut verifica disponibilitatea orei. Oferta nu a fost trimisă. Reîncearcă.",
  "Ora selectată este ocupată. Alege altă oră înainte de a trimite oferta.",
  "Authentication required",
  "Workshop role required",
  "Repair request is not available for a new offer",
  "Appointment slot is no longer available",
  "Only the offer workshop can create the initial appointment.",
  "The appointment does not match an open repair request.",
  "The appointment does not match a pending workshop offer.",
  "A workshop appointment must start in requested status.",
  "Cererea este actualizată. Reîncearcă operația.",
  "Cererea nu a fost găsită.",
  "Cererea nu mai acceptă oferte.",
  "Programarea nu poate fi creată sau confirmată pentru această cerere.",
  "Adresa de preluare a cererii Towing nu este disponibilă.",
]);

export function towingOfferErrorMessage(error: unknown): string {
  const failure = error && typeof error === "object" ? error : null;
  const rawCode = failure && "code" in failure ? failure.code : null;
  const code = typeof rawCode === "string" && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(rawCode)
    ? rawCode : "";
  const rawMessage = failure && "message" in failure ? failure.message : null;
  const message = typeof rawMessage === "string" && safeMessages.has(rawMessage)
    ? rawMessage
    : "Nu am putut confirma trimiterea ofertei. Mesajul tehnic este mascat pentru protecția datelor.";
  return `${message}${code ? ` (${code})` : ""}\nVerifică lista ofertelor înainte de a reîncerca.`;
}
