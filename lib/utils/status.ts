export function formatOfferStatus(value: string) {
  switch (value) {
    case "accepted":
      return "Lucrare confirmată";
    case "rejected":
      return "Respinsă";
    default:
      return "În așteptare";
  }
}