type WorkshopRequestsHeaderProps = {
  title: string;
  description?: string;
  count: number;
};

export default function WorkshopRequestsHeader({
  title,
  description,
  count,
}: WorkshopRequestsHeaderProps) {
  return (
    <header className="mb-8 text-center">
      <h1 className="text-[28px] font-bold leading-tight tracking-tight text-white md:text-[30px]">
        {title}
      </h1>

      {description && (
        <p className="mx-auto mt-2.5 max-w-2xl whitespace-nowrap text-[11px] leading-5 text-white/60 min-[390px]:text-[11.5px] min-[430px]:text-xs">
          {description}
        </p>
      )}

      <div className="mt-3.5 inline-flex rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white/70">
        {count} lucrări
      </div>
    </header>
  );
}
