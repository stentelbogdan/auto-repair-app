type WorkshopOfferCardProps = {
  workshopName?: string | null;
  price?: string | number | null;
  days?: string | number | null;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
};

export default function WorkshopOfferCard({
  workshopName,
  price,
  days,
  onClick,
}: WorkshopOfferCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-3xl bg-black/[0.04] p-4 text-left transition hover:bg-black/[0.07] active:scale-[0.99]"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-black/45">Service</p>

          <p className="mt-1 truncate text-lg font-black">
            {workshopName || "Service"}
          </p>

          <p className="mt-1 text-sm font-semibold text-black/50">
            Vezi profilul și review-urile →
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xl font-black">
            {price ? `€${price}` : "—"}
          </p>

          <p className="mt-1 text-sm font-semibold text-black/50">
            {days || "—"}
          </p>
        </div>
      </div>
    </button>
  );
}