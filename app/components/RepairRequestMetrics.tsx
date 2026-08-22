import { Eye } from "lucide-react";

type RepairRequestMetricsProps = {
  viewCount: number;
  offerCount: number;
};

export default function RepairRequestMetrics({
  viewCount,
  offerCount,
}: RepairRequestMetricsProps) {
  return (
    <div
      className="mt-3 flex w-fit items-center gap-1.5 rounded-full border border-black/10 bg-black/[0.035] px-3 py-1.5 text-xs font-semibold text-black/55"
      aria-label={`${formatViews(viewCount)}, ${formatOffers(offerCount)}`}
    >
      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{formatViews(viewCount)}</span>
      <span className="text-black/25" aria-hidden="true">
        ·
      </span>
      <span>{formatOffers(offerCount)}</span>
    </div>
  );
}

function formatViews(count: number) {
  return `${count} ${count === 1 ? "vizualizare" : "vizualizări"}`;
}

function formatOffers(count: number) {
  return `${count} ${count === 1 ? "ofertă" : "oferte"}`;
}
