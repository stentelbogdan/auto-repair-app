type RequestClientNameProps = {
  name?: string | null;
  variant?: "compact" | "detail";
};

export default function RequestClientName({
  name,
  variant = "compact",
}: RequestClientNameProps) {
  const displayName = name?.trim() || "Client";

  if (variant === "detail") {
    return (
      <div className="mt-5 rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-black/40">
          Client
        </p>
        <p className="mt-1 text-sm font-bold text-black/80">{displayName}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex w-fit max-w-full items-center gap-1.5 rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-xs text-black/65">
      <span className="font-semibold text-black/45">Client</span>
      <span aria-hidden="true">•</span>
      <span className="truncate font-bold text-black/75">{displayName}</span>
    </div>
  );
}
