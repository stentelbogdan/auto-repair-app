"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";

type ProfileRow = {
  role: string[] | null;
};

export default function CustomerDashboardPage() {
  const router = useRouter();
  const [isWorkshop, setIsWorkshop] = useState<boolean | null>(null);

  useEffect(() => {
    const loadRole = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        router.push("/login");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", session.user.id)
        .single<ProfileRow>();

      const roles = Array.isArray(profile?.role) ? profile.role : [];
      const savedRole = localStorage.getItem("activeRole");

      setIsWorkshop(savedRole === "workshop" && roles.includes("workshop"));
    };

    loadRole();
  }, [router]);

  if (isWorkshop === null) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black text-white">
        Se încarcă...
      </main>
    );
  }

  return (
    <main className="h-[calc(100dvh-86px)] overflow-hidden bg-[#101010] px-4 py-2 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="mt-10 grid grid-cols-2 gap-3">
          {!isWorkshop && (
            <>
              <Card title="Postează" desc="Încarcă poze și descriere" icon="+" onClick={() => router.push("/post-job")} />
              <Card title="Postările tale" desc="Toate daunele tale" icon="📄" onClick={() => router.push("/customer/my-requests")} />
              <Card title="Oferte primite" desc="Compară ofertele" icon="€" onClick={() => router.push("/offers")} />
              <Card title="Programări" desc="Lucrări programate" icon="✓" onClick={() => router.push("/customer/my-jobs")} />
            </>
          )}

          {isWorkshop && (
            <>
              <Card title="Daune disponibile" desc="Vezi cererile clienților" icon="€" onClick={() => router.push("/workshops")} />
              <Card title="Ofertele tale" desc="Toate ofertele trimise" icon="📤" onClick={() => router.push("/workshops/my-offers")} />
              <Card title="Lucrări câștigate" desc="Joburi acceptate" icon="🏆" onClick={() => router.push("/workshops/won-jobs")} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Card({
  title,
  desc,
  icon,
  onClick,
}: {
  title: string;
  desc: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="rounded-[20px] bg-white p-4 text-center text-black shadow-lg transition active:scale-[0.98]"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-2xl font-bold">
        {icon}
      </div>
      <h2 className="text-base font-bold leading-tight">{title}</h2>
      <p className="mt-1 text-xs leading-snug text-black/55">{desc}</p>
    </button>
  );
}