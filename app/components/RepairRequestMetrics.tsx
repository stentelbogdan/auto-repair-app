import { Eye, MessageCircle } from "lucide-react";

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
      className="mt-3 flex w-fit flex-col items-start gap-1 rounded-full border border-black/10 bg-black/[0.035] px-3 py-1.5 text-[13px] font-semibold leading-[18px] text-black/65"
      aria-label={`${formatViews(viewCount)}, ${formatOffers(offerCount)}`}
    >
      <span className="flex items-center gap-1.5">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        {formatViews(viewCount)}
      </span>
      <span className="flex items-center gap-1.5">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
        {formatOffers(offerCount)}
      </span>
    </div>
  );
}

function formatViews(count: number) {
  return `${count} ${count === 1 ? "vizualizare" : "vizualizări"}`;
}

function formatOffers(count: number) {
  return `${count} ${count === 1 ? "ofertă" : "oferte"}`;
}
