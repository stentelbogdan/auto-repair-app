type ReviewPageProps = {
  searchParams: Promise<{
    carBrand?: string;
    carModel?: string;
    carYear?: string;
    city?: string;
    damageType?: string;
    description?: string;
    images?: string;
  }>;
};

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const params = await searchParams;

  const carBrand = params.carBrand || "-";
  const carModel = params.carModel || "-";
  const carYear = params.carYear || "-";
  const city = params.city || "-";
  const damageType = params.damageType || "-";
  const description = params.description || "";

  let images: any[] = [];

  if (params.images) {
    try {
      const parsed = JSON.parse(params.images);
      images = Array.isArray(parsed) ? parsed : [];
    } catch {
      images = [];
    }
  }

  return (
    <main className="min-h-screen bg-black px-6 py-10 text-white">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Review request
            </p>
            <h1 className="mt-2 text-3xl font-bold md:text-4xl">
              Check your repair request
            </h1>
          </div>

          <a
            href="/"
            className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Back
          </a>
        </div>

        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5">
          <div className="grid gap-6 p-6 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Car brand</p>
              <p className="mt-1 text-lg font-semibold">{carBrand}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Car model</p>
              <p className="mt-1 text-lg font-semibold">{carModel}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">Year</p>
              <p className="mt-1 text-lg font-semibold">{carYear}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4">
              <p className="text-sm text-white/50">City</p>
              <p className="mt-1 text-lg font-semibold">{city}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4 md:col-span-2">
              <p className="text-sm text-white/50">Damage type</p>
              <p className="mt-1 text-lg font-semibold">{damageType}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-black/30 p-4 md:col-span-2">
              <p className="text-sm text-white/50">Description</p>
              <p className="mt-1 text-white/85">
                {description || "No description provided."}
              </p>
            </div>
          </div>

          <div className="px-6 pb-6">
            <p className="mb-3 text-sm text-white/60">Uploaded photos</p>

            {images.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {images.map((image: any, index: number) => (
                  <img
                    key={`${image?.name || "image"}-${index}`}
                    src={image?.dataUrl || ""}
                    alt={`Uploaded photo ${index + 1}`}
                    className="h-64 w-full rounded-xl border border-white/10 object-cover"
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-white/50">
                No photos uploaded.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}