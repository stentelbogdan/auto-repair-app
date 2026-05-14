"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera,
  Check,
  Clock,
  ImagePlus,
  Mail,
  MapPin,
  Phone,
  Shield,
  Store,
  User,
  Wrench,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  email: string | null;
  role: string[] | null;
  workshop_name?: string | null;
  workshop_phone?: string | null;
  workshop_address?: string | null;
  workshop_city?: string | null;
  workshop_hours?: string | null;
  workshop_description?: string | null;
  workshop_logo_url?: string | null;
  workshop_gallery_urls?: string[] | null;
};

export default function AccountPage() {
  const router = useRouter();
  const [accountMode, setAccountMode] = useState<"customer" | "workshop">(
    "customer",
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");

    if (role === "workshop") {
      setAccountMode("workshop");
    } else {
      setAccountMode("customer");
    }
  }, []);

  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [workshopName, setWorkshopName] = useState("");
  const [workshopPhone, setWorkshopPhone] = useState("");
  const [workshopAddress, setWorkshopAddress] = useState("");
  const [workshopCity, setWorkshopCity] = useState("");
  const [workshopHours, setWorkshopHours] = useState("");
  const [workshopDescription, setWorkshopDescription] = useState("");
  const [workshopLogoUrl, setWorkshopLogoUrl] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [workshopGalleryUrls, setWorkshopGalleryUrls] = useState<string[]>([]);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();

        if (!authData.user) {
          router.push("/login");
          return;
        }

        const { data: profile, error } = await supabase
          .from("profiles")
          .select(
            "email, role, workshop_name, workshop_phone, workshop_address, workshop_city, workshop_hours, workshop_description, workshop_logo_url, workshop_gallery_urls",
          )
          .eq("id", authData.user.id)
          .single<ProfileRow>();

        if (error) {
          alert(error.message);
          router.push("/");
          return;
        }

        setEmail(profile?.email || authData.user.email || "");
        setRoles(Array.isArray(profile?.role) ? profile.role : []);

        setWorkshopName(profile?.workshop_name || "");
        setWorkshopPhone(profile?.workshop_phone || "");
        setWorkshopAddress(profile?.workshop_address || "");
        setWorkshopCity(profile?.workshop_city || "");
        setWorkshopHours(profile?.workshop_hours || "");
        setWorkshopDescription(profile?.workshop_description || "");
        setWorkshopLogoUrl(profile?.workshop_logo_url || "");

        setWorkshopGalleryUrls(
          Array.isArray(profile?.workshop_gallery_urls)
            ? profile.workshop_gallery_urls
            : [],
        );
      } catch (error) {
        console.error("Failed to load account:", error);
        router.push("/");
      } finally {
        setLoading(false);
      }
    };

    loadAccount();
  }, [router]);

  const toggleRole = (role: "customer" | "workshop") => {
    setRoles((prev) => {
      if (prev.includes(role)) {
        const next = prev.filter((r) => r !== role);
        return next.length ? next : ["customer"];
      }

      return Array.from(new Set([...prev, role]));
    });
  };

  const handleLogoUpload = async (file: File) => {
    try {
      setUploadingLogo(true);

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const fileExt = file.name.split(".").pop();
      const fileName = `${authData.user.id}/logo-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("workshop-assets")
        .upload(fileName, file, {
          cacheControl: "3600",
          upsert: true,
        });

      if (uploadError) {
        alert(uploadError.message);
        return;
      }

      const { data } = supabase.storage
        .from("workshop-assets")
        .getPublicUrl(fileName);

      setWorkshopLogoUrl(data.publicUrl);
    } catch (error) {
      console.error("Logo upload failed:", error);
      alert("Logo upload failed.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleGalleryUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    try {
      setUploadingGallery(true);

      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const uploadedUrls: string[] = [];

      for (const file of Array.from(files)) {
        const fileExt = file.name.split(".").pop();
        const fileName = `${authData.user.id}/gallery-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("workshop-assets")
          .upload(fileName, file, {
            cacheControl: "3600",
            upsert: true,
          });

        if (uploadError) {
          alert(uploadError.message);
          continue;
        }

        const { data } = supabase.storage
          .from("workshop-assets")
          .getPublicUrl(fileName);

        uploadedUrls.push(data.publicUrl);
      }

      setWorkshopGalleryUrls((prev) => [...prev, ...uploadedUrls].slice(0, 8));
    } catch (error) {
      console.error("Gallery upload failed:", error);
      alert("Gallery upload failed.");
    } finally {
      setUploadingGallery(false);
    }
  };

  const removeGalleryImage = (url: string) => {
    setWorkshopGalleryUrls((prev) => prev.filter((item) => item !== url));
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const { data: authData } = await supabase.auth.getUser();

      if (!authData.user) {
        router.push("/login");
        return;
      }

      const safeRoles = roles.length ? roles : ["customer"];

      const { error } = await supabase
        .from("profiles")
        .update({
          role: safeRoles,
          workshop_name: workshopName,
          workshop_phone: workshopPhone,
          workshop_address: workshopAddress,
          workshop_city: workshopCity,
          workshop_hours: workshopHours,
          workshop_description: workshopDescription,
          workshop_logo_url: workshopLogoUrl,
          workshop_gallery_urls: workshopGalleryUrls,
        })
        .eq("id", authData.user.id);

      if (error) {
        alert(error.message);
        return;
      }

      alert("Account updated successfully.");

      if (accountMode === "workshop" && safeRoles.includes("workshop")) {
        localStorage.setItem("activeRole", "workshop");
        router.push("/workshops/dashboard");
        return;
      }

      if (accountMode === "customer" && safeRoles.includes("customer")) {
        localStorage.setItem("activeRole", "customer");
        router.push("/customer/dashboard");
        return;
      }

      router.refresh();
    } catch (error) {
      console.error("Failed to save account:", error);
      alert("Something went wrong while saving.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black px-5 py-10 text-white">
        <div className="mx-auto flex min-h-[60vh] max-w-5xl items-center justify-center">
          <p className="text-white/60">Loading account...</p>
        </div>
      </main>
    );
  }

  const hasCustomer = roles.includes("customer");
  const hasWorkshop = roles.includes("workshop");
  const hasAdmin = roles.includes("admin");

  return (
    <main className="min-h-screen bg-black px-5 py-8 text-white md:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-orange-400">
              Account
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
              {accountMode === "workshop"
                ? "Service profile"
                : "Customer profile"}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/55 md:text-base">
              {accountMode === "workshop"
                ? "Build your workshop identity. This information will later appear on your public service profile."
                : "Manage your customer account and access settings."}
            </p>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-2xl bg-orange-500 px-6 py-3 font-semibold text-black shadow-[0_0_35px_rgba(249,115,22,0.35)] transition hover:bg-orange-400 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[0.9fr_1.4fr]">
          <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
            <div className="rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/10 to-white/[0.03] p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-orange-400/30 bg-orange-500/10">
                  {workshopLogoUrl ? (
                    <img
                      src={workshopLogoUrl}
                      alt="Workshop logo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Store className="h-9 w-9 text-orange-400" />
                  )}
                </div>

                <div>
                  <p className="text-sm text-white/45">Signed in as</p>
                  <p className="mt-1 break-all font-semibold text-white">
                    {email}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                <InfoCard
                  icon={<Mail size={17} />}
                  label="Email"
                  value={email || "Not set"}
                />
                <InfoCard
                  icon={<Store size={17} />}
                  label="Service name"
                  value={workshopName || "Add your workshop name"}
                />
                <InfoCard
                  icon={<MapPin size={17} />}
                  label="City"
                  value={workshopCity || "Add your city"}
                />
                <InfoCard
                  icon={<Phone size={17} />}
                  label="Phone"
                  value={workshopPhone || "Add your phone number"}
                />
              </div>
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-white/10 bg-black/30 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/35">
                Access
              </p>

              <div className="mt-4 space-y-3">
                <RoleButton
                  active={hasCustomer}
                  title="Customer"
                  description="Post repair jobs"
                  icon={<User size={18} />}
                  onClick={() => toggleRole("customer")}
                />

                <RoleButton
                  active={hasWorkshop}
                  title="Workshop"
                  description="Browse jobs and send offers"
                  icon={<Wrench size={18} />}
                  onClick={() => toggleRole("workshop")}
                />

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center gap-3">
                    <Shield className="h-5 w-5 text-white/45" />
                    <div className="flex-1">
                      <p className="font-semibold text-white">Admin</p>
                      <p className="text-sm text-white/45">
                        Managed manually in Supabase
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        hasAdmin
                          ? "bg-green-500/15 text-green-300"
                          : "bg-white/10 text-white/50"
                      }`}
                    >
                      {hasAdmin ? "Enabled" : "Off"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-5 shadow-2xl">
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                label="Service name"
                value={workshopName}
                onChange={setWorkshopName}
                placeholder="Example: DW Werkplaats"
              />

              <Field
                label="Phone"
                value={workshopPhone}
                onChange={setWorkshopPhone}
                placeholder="+49..."
              />

              <Field
                label="Address"
                value={workshopAddress}
                onChange={setWorkshopAddress}
                placeholder="Street and number"
              />

              <Field
                label="City"
                value={workshopCity}
                onChange={setWorkshopCity}
                placeholder="Kleve"
              />

              <Field
                label="Opening hours"
                value={workshopHours}
                onChange={setWorkshopHours}
                placeholder="Mon - Fri, 08:00 - 17:00"
                icon={<Clock size={17} />}
              />

              <div>
                <label className="mb-2 block text-sm font-medium text-white/70">
                  Logo / avatar
                </label>

                <label className="flex min-h-[52px] cursor-pointer items-center justify-center rounded-2xl border border-white/10 bg-black/35 px-4 py-3 font-semibold text-white transition hover:border-orange-400/60 hover:bg-orange-500/10">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      handleLogoUpload(file);
                    }}
                  />

                  {uploadingLogo ? "Uploading..." : "Upload logo"}
                </label>

                {workshopLogoUrl && (
                  <p className="mt-2 truncate text-xs text-white/35">
                    Logo uploaded successfully
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-white/70">
                Service description
              </label>
              <textarea
                value={workshopDescription}
                onChange={(e) => setWorkshopDescription(e.target.value)}
                placeholder="Describe your workshop, experience, paint/body repair services, specialties..."
                rows={7}
                className="w-full resize-none rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-orange-400/60"
              />
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-dashed border-white/15 bg-black/25 p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-400">
                    <ImagePlus size={22} />
                  </div>
                  <div>
                    <p className="font-semibold text-white">Workshop gallery</p>
                    <p className="text-sm text-white/45">
                      Upload up to 8 workshop photos.
                    </p>
                  </div>
                </div>

                <label className="cursor-pointer rounded-2xl bg-orange-500 px-4 py-2 text-sm font-bold text-black transition hover:bg-orange-400">
                  {uploadingGallery ? "Uploading..." : "Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => handleGalleryUpload(e.target.files)}
                  />
                </label>
              </div>

              {workshopGalleryUrls.length > 0 && (
                <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {workshopGalleryUrls.map((url) => (
                    <div
                      key={url}
                      className="group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                    >
                      <img
                        src={url}
                        alt="Workshop gallery"
                        className="h-full w-full object-cover"
                      />

                      <button
                        type="button"
                        onClick={() => removeGalleryImage(url)}
                        className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-1 text-xs font-bold text-white opacity-100 transition md:opacity-0 md:group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button
                onClick={() => router.push("/")}
                disabled={!hasCustomer}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Customer area
              </button>

              <button
                onClick={() => router.push("/workshops")}
                disabled={!hasWorkshop}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Workshop area
              </button>

              <button
                onClick={() => router.push("/admin")}
                disabled={!hasAdmin}
                className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-35"
              >
                Admin area
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  icon,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-white/70">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-white/35">
            {icon}
          </div>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full rounded-2xl border border-white/10 bg-black/35 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-orange-400/60 ${
            icon ? "pl-11 pr-4" : "px-4"
          }`}
        />
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="flex items-center gap-3 text-white/45">
        {icon}
        <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      </div>
      <p className="mt-2 break-words text-sm font-semibold text-white">
        {value}
      </p>
    </div>
  );
}

function RoleButton({
  active,
  title,
  description,
  icon,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        active
          ? "border-orange-400/40 bg-orange-500/10"
          : "border-white/10 bg-white/[0.04] hover:bg-white/10"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
            active ? "bg-orange-500 text-black" : "bg-white/10 text-white/60"
          }`}
        >
          {active ? <Check size={18} /> : icon}
        </div>

        <div className="flex-1">
          <p className="font-semibold text-white">{title}</p>
          <p className="text-sm text-white/45">{description}</p>
        </div>

        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            active ? "bg-orange-500 text-black" : "bg-white/10 text-white/50"
          }`}
        >
          {active ? "On" : "Off"}
        </span>
      </div>
    </button>
  );
}
