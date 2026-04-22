"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import {
  getOffersForWorkshop,
  type RepairOfferRow,
} from "@/lib/supabase/repair-offers";

type RepairRequest = {
  id: string;
  carBrand: string;
  carModel: string;
  carYear: string;
  city: string;
  damageType: string;
  description: string;
  images: {
    name: string;
    dataUrl: string;
  }[];
  afterImages: {
    name: string;
    dataUrl: string;
  }[];
  status?: string;
  acceptedOfferId?: string | null;
};

type RepairOffer = {
  id: string;
  requestId: string;
  price: string;
  days: string;
  message: string;
  workshopName: string;
  createdAt: string;
  status?: string;
};

type ProfileRow = {
  role: string[] | null;
};

type RepairRequestRow = {
  id: string;
  car_brand: string;
  car_model: string;
  car_year: string;
  city: string;
  damage_type: string;
  description: string | null;
  images: {
    name: string;
    dataUrl: string;
  }[];
  after_images: {
    name: string;
    dataUrl: string;
  }[];
  status: string;
  accepted_offer_id: string | null;
};

export default function WorkshopRequestDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;

  const [request, setRequest] = useState<RepairRequest | null>(null);
  const [offers, setOffers] = useState<RepairOffer[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [uploadingAfterImages, setUploadingAfterImages] = useState(false);

  useEffect(() => {
    const loadPage = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (profileError) {
          console.error("Failed to load profile:", profileError);
          router.push("/");
          return;
        }

        const roles = Array.isArray(profile?.role) ? profile.role : [];

        if (!roles.includes("workshop")) {
          router.push("/");
          return;
        }

        const { data: requestRow, error: requestError } = await supabase
          .from("repair_requests")
          .select("*")
          .eq("id", id)
          .single<RepairRequestRow>();

        if (requestError || !requestRow) {
          console.error("Failed to load request details:", requestError);
          setRequest(null);
          setOffers([]);
          return;
        }

        setRequest({
  id: requestRow.id,
  carBrand: requestRow.car_brand || "Unknown brand",
  carModel: requestRow.car_model || "Unknown model",
  carYear: requestRow.car_year || "-",
  city: requestRow.city || "-",
  damageType: formatDamageType(requestRow.damage_type || "other"),
  description: requestRow.description || "No description provided.",
  images: Array.isArray(requestRow.images) ? requestRow.images : [],
  afterImages: Array.isArray(requestRow.after_images)
    ? requestRow.after_images
    : [],
  status: requestRow.status || "open",
  acceptedOfferId: requestRow.accepted_offer_id,
});

        const workshopOffers = await getOffersForWorkshop(authData.user.id);

        const relatedOffers: RepairOffer[] = workshopOffers
          .filter((offer: RepairOfferRow) => offer.request_id === id)
          .map((offer: RepairOfferRow) => ({
            id: offer.id,
            requestId: offer.request_id,
            price: offer.price,
            days: offer.days,
            message: offer.message || "",
            workshopName: offer.workshop_name,
            createdAt: offer.created_at,
            status: offer.status,
          }));

        setOffers(relatedOffers);
      } catch (error) {
        console.error("Failed to load request details:", error);
        setRequest(null);
        setOffers([]);
      } finally {
        setIsLoaded(true);
      }
    };

    loadPage();
  }, [id, router]);

  const updateJobStatus = async (newStatus: "in_progress" | "completed") => {
    if (!request) return;

    try {
      setUpdatingStatus(true);

      const { error } = await supabase
        .from("repair_requests")
        .update({ status: newStatus })
        .eq("id", request.id);

      if (error) {
        throw error;
      }

      setRequest((prev) =>
        prev
          ? {
              ...prev,
              status: newStatus,
            }
          : prev
      );
    } catch (error) {
      console.error("Failed to update job status:", error);
      alert("Failed to update job status.");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleAfterImagesUpload = async (
  event: React.ChangeEvent<HTMLInputElement>
) => {
  if (!request) return;

  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  try {
    setUploadingAfterImages(true);

    const fileToDataUrl = (file: File) =>
      new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          resolve({
            name: file.name,
            dataUrl: String(reader.result || ""),
          });
        };

        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

    const uploadedImages = await Promise.all(files.map(fileToDataUrl));

    const updatedAfterImages = [
      ...(request.afterImages || []),
      ...uploadedImages,
    ];

    const { error } = await supabase
      .from("repair_requests")
      .update({
        after_images: updatedAfterImages,
      })
      .eq("id", request.id);

    if (error) {
      throw error;
    }

    setRequest((prev) =>
      prev
        ? {
            ...prev,
            afterImages: updatedAfterImages,
          }
        : prev
    );
  } catch (error) {
    console.error("Failed to upload after images:", error);
    alert("Failed to upload after images.");
  } finally {
    setUploadingAfterImages(false);
    event.target.value = "";
  }
};

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-white/70">Loading job...</p>
      </main>
    );
  }

  if (!request) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        <p className="text-white/70">Job not found.</p>
      </main>
    );
  }

  const acceptedOffer =
    offers.find((offer) => offer.id === request.acceptedOfferId) ||
    offers.find((offer) => offer.status === "accepted") ||
    null;

  const isMatched = request.status === "matched";
  const isInProgress = request.status === "in_progress";
  const isCompleted = request.status === "completed";

  return (
    <main className="min-h-screen bg-black px-6 pb-10 pt-4 text-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => router.push("/workshops/won-jobs")}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Back to won jobs
          </button>

          <span className={getJobStatusClass(request.status || "matched")}>
            {formatJobStatus(request.status || "matched")}
          </span>
        </div>

        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-white/40">
              Workshop job
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight md:text-5xl">
              {request.carBrand} {request.carModel}
            </h1>
            <p className="mt-3 max-w-2xl text-white/70">
              Manage this accepted repair job, track progress, and update the
              workflow from your workshop dashboard.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
            <p className="text-xs uppercase tracking-[0.18em] text-white/45">
              Location
            </p>
            <p className="mt-2 text-lg font-semibold">
              {request.city} • {request.carYear}
            </p>
          </div>
        </div>

        <div className="grid gap-8 xl:grid-cols-[1.35fr_0.9fr]">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
              {request.images.length > 0 ? (
                <img
                  src={request.images[0].dataUrl}
                  alt={`${request.carBrand} ${request.carModel}`}
                  className="h-[420px] w-full object-cover"
                />
              ) : (
                <div className="flex h-[420px] items-center justify-center bg-white/5 text-white/40">
                  No photo uploaded
                </div>
              )}
            </div>

            {request.images.length > 1 && (
              <div>
                <p className="mb-3 text-sm uppercase tracking-[0.18em] text-white/45">
                  Additional photos
                </p>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  {request.images.slice(1).map((image, index) => (
                    <img
                      key={`${image.name}-${index}`}
                      src={image.dataUrl}
                      alt={`Additional ${index + 1}`}
                      className="h-32 w-full rounded-2xl border border-white/10 object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-white/45">
        Repair photos
      </p>
      <h3 className="mt-2 text-xl font-semibold text-white">
        Before / After
      </h3>
    </div>

    <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-black transition hover:opacity-90">
      {uploadingAfterImages ? "Uploading..." : "Upload after photos"}
      <input
        type="file"
        accept="image/*"
        multiple
        onChange={handleAfterImagesUpload}
        className="hidden"
      />
    </label>
  </div>

  <div className="mt-6 grid gap-6 lg:grid-cols-2">
    <div>
      <p className="mb-3 text-sm font-medium text-white/65">Before</p>
      {request.images.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {request.images.map((image, index) => (
            <img
              key={`${image.name}-${index}`}
              src={image.dataUrl}
              alt={`Before ${index + 1}`}
              className="h-32 w-full rounded-2xl border border-white/10 object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-white/40">
          No before photos
        </div>
      )}
    </div>

    <div>
      <p className="mb-3 text-sm font-medium text-white/65">After</p>
      {request.afterImages.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {request.afterImages.map((image, index) => (
            <img
              key={`${image.name}-${index}`}
              src={image.dataUrl}
              alt={`After ${index + 1}`}
              className="h-32 w-full rounded-2xl border border-white/10 object-cover"
            />
          ))}
        </div>
      ) : (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 text-white/40">
          No after photos yet
        </div>
      )}
    </div>
  </div>
</div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                Customer request
              </p>
              <p className="mt-4 text-base leading-7 text-white/85">
                {request.description}
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black">
                  {request.damageType}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {request.carYear}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                  {request.city}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.03] p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                Accepted offer
              </p>

              {acceptedOffer ? (
                <>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-white/50">Workshop</p>
                        <p className="mt-1 text-lg font-semibold">
                          {acceptedOffer.workshopName}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-right">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">
                          Price
                        </p>
                        <p className="mt-1 text-3xl font-bold tracking-tight">
                          €{acceptedOffer.price}
                        </p>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-4">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-sm text-white/50">Estimated time</p>
                        <p className="mt-1 text-lg font-semibold">
                          {acceptedOffer.days} day
                          {acceptedOffer.days !== "1" ? "s" : ""}
                        </p>
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <p className="text-sm text-white/50">Offer status</p>
                        <p className="mt-1 text-lg font-semibold">
                          {formatOfferStatus(acceptedOffer.status || "accepted")}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <p className="text-sm text-white/50">Your message</p>
                      <p className="mt-2 text-sm leading-6 text-white/80">
                        {acceptedOffer.message || "No message provided."}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-5 text-white/70">
                  Accepted offer not found.
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                Job progress
              </p>

              <div className="mt-5 space-y-3">
                <ProgressStep
                  active={isMatched || isInProgress || isCompleted}
                  complete={isInProgress || isCompleted}
                  title="Job accepted"
                  subtitle="Customer accepted your offer."
                />
                <ProgressStep
                  active={isInProgress || isCompleted}
                  complete={isCompleted}
                  title="Repair in progress"
                  subtitle="Workshop has started working on the vehicle."
                />
                <ProgressStep
                  active={isCompleted}
                  complete={isCompleted}
                  title="Repair completed"
                  subtitle="Job marked as finished."
                />
              </div>

              <div className="mt-6 grid gap-3">
                <button
                  onClick={() => updateJobStatus("in_progress")}
                  disabled={updatingStatus || isInProgress || isCompleted}
                  className="rounded-2xl border border-white/15 bg-white/5 px-5 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isInProgress
                    ? "Repair started"
                    : isCompleted
                    ? "Job already completed"
                    : updatingStatus
                    ? "Updating..."
                    : "Start repair"}
                </button>

                <button
                  onClick={() => updateJobStatus("completed")}
                  disabled={updatingStatus || isCompleted}
                  className="rounded-2xl bg-white px-5 py-3 font-semibold text-black transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCompleted
                    ? "Completed"
                    : updatingStatus
                    ? "Updating..."
                    : "Mark as completed"}
                </button>
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
              <p className="text-xs uppercase tracking-[0.18em] text-white/45">
                Job details
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <InfoCard label="Car" value={`${request.carBrand} ${request.carModel}`} />
                <InfoCard label="Year" value={request.carYear} />
                <InfoCard label="City" value={request.city} />
                <InfoCard label="Damage type" value={request.damageType} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ProgressStep({
  active,
  complete,
  title,
  subtitle,
}: {
  active: boolean;
  complete: boolean;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div
        className={`mt-1 h-3.5 w-3.5 rounded-full ${
          complete
            ? "bg-green-400"
            : active
            ? "bg-yellow-300"
            : "bg-white/15"
        }`}
      />
      <div>
        <p className="font-semibold text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-white/60">{subtitle}</p>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function formatJobStatus(value: string) {
  switch (value) {
    case "completed":
      return "Completed";
    case "in_progress":
      return "In progress";
    case "matched":
      return "Accepted";
    default:
      return "Open";
  }
}

function getJobStatusClass(value: string) {
  switch (value) {
    case "completed":
      return "rounded-full border border-green-500/20 bg-green-500/15 px-3 py-1 text-xs font-medium text-green-300";
    case "in_progress":
      return "rounded-full border border-blue-500/20 bg-blue-500/15 px-3 py-1 text-xs font-medium text-blue-300";
    case "matched":
      return "rounded-full border border-yellow-500/20 bg-yellow-500/15 px-3 py-1 text-xs font-medium text-yellow-300";
    default:
      return "rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70";
  }
}

function formatDamageType(value: string) {
  switch (value) {
    case "scratch":
    case "Scratch":
      return "Scratch";
    case "dent":
    case "Dent":
      return "Dent";
    case "bumper":
    case "Bumper damage":
      return "Bumper damage";
    case "paint":
    case "Paint damage":
      return "Paint damage";
    case "cracked_part":
    case "Cracked part":
      return "Cracked part";
    default:
      return "Other";
  }
}

function formatOfferStatus(value: string) {
  switch (value) {
    case "accepted":
      return "Accepted";
    case "rejected":
      return "Rejected";
    default:
      return "Pending";
  }
}