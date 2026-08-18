"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-provider";
import { createWorkshopSlug } from "@/lib/workshops/workshop-slug";

type UserRole = "customer" | "workshop";

export default function RegisterPage() {
  const router = useRouter();
  const { setActiveRole } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [role, setRole] = useState<UserRole>("customer");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gdprAccepted, setGdprAccepted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChooseRole = (selectedRole: UserRole) => {
    setRole(selectedRole);
    setStep(2);
  };

  const handleRegister = async () => {
    if (!name || !city || !email || !password) {
      alert("Te rugăm să completezi toate câmpurile.");
      return;
    }

    if (!gdprAccepted) {
      alert("Trebuie să accepți termenii și politica GDPR.");
      return;
    }

    setLoading(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        alert(error.message);
        return;
      }

      const userId = data.user?.id;

      if (!userId) {
        alert("Contul nu a putut fi creat.");
        return;
      }

      const profileData =
        role === "workshop"
          ? {
              id: userId,
              email,
              role: ["workshop"],
              full_name: name,
              display_name: name,
              city,
              workshop_name: name,
              workshop_city: city,
              ...(data.session
                ? { workshop_slug: createWorkshopSlug(name, userId) }
                : {}),
              gdpr_accepted: true,
              gdpr_accepted_at: new Date().toISOString(),
            }
          : {
              id: userId,
              email,
              role: ["customer"],
              full_name: name,
              display_name: name,
              city,
              gdpr_accepted: true,
              gdpr_accepted_at: new Date().toISOString(),
            };

      const { error: profileError } = await supabase
        .from("profiles")
        .upsert(profileData);

      if (profileError) {
        alert(profileError.message);
        return;
      }

      setActiveRole(role);
      localStorage.setItem("activeRole", role);

      if (!data.session) {
        alert(
          "Cont creat cu succes. Verifică emailul dacă este necesar, apoi autentifică-te.",
        );
        router.push("/login");
        return;
      }

      if (role === "workshop") {
        router.push("/workshops/dashboard");
        return;
      }

      router.push("/customer/dashboard");
    } catch (err) {
      console.error("Register failed:", err);
      alert("A apărut o problemă la crearea contului.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRegister = async () => {
    localStorage.setItem("pendingRegisterRole", role);
    localStorage.setItem("activeRole", role);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      alert(error.message);
    }
  };

  return (
    <main className="min-h-screen bg-[#101010] px-4 py-6 text-white">
      <div className="mx-auto flex min-h-[85vh] max-w-md items-center justify-center">
        <div className="w-full rounded-[32px] bg-white p-6 text-black shadow-2xl">
          {step === 1 ? (
            <>
              <div className="mb-10 text-center">
                <button
                  onClick={() => router.push("/login")}
                  className="mb-6 mr-auto block text-2xl"
                >
                  ←
                </button>

                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-500">
                  AutoRepair Marketplace
                </p>

                <h1 className="mt-4 text-3xl font-black tracking-tight">
                  Alătură-te
                </h1>

                <p className="mt-2 text-sm text-black/55">
                  Alege tipul de cont pe care vrei să îl creezi.
                </p>
              </div>

              <div className="space-y-4">
                <button
                  type="button"
                  onClick={() => handleChooseRole("customer")}
                  className="w-full rounded-3xl border border-black/10 bg-black/[0.03] p-6 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="text-4xl">🚗</div>
                  <div className="mt-4 text-2xl font-black">Client</div>
                  <p className="mt-1 text-sm text-black/50">
                    Postează daune și primește oferte de la service-uri.
                  </p>
                </button>

                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-black/10" />
                  <span className="text-sm font-semibold text-black/40">
                    SAU
                  </span>
                  <div className="h-px flex-1 bg-black/10" />
                </div>

                <button
                  type="button"
                  onClick={() => handleChooseRole("workshop")}
                  className="w-full rounded-3xl border border-black/10 bg-black/[0.03] p-6 text-left shadow-sm transition active:scale-[0.99]"
                >
                  <div className="text-4xl">🔧</div>
                  <div className="mt-4 text-2xl font-black">Service auto</div>
                  <p className="mt-1 text-sm text-black/50">
                    Primește lucrări noi și trimite oferte clienților.
                  </p>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-7 text-center">
                <button
                  onClick={() => setStep(1)}
                  className="mb-6 mr-auto block text-2xl"
                >
                  ←
                </button>

                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-orange-500">
                  {role === "workshop" ? "Cont service" : "Cont client"}
                </p>

                <h1 className="mt-4 text-3xl font-black tracking-tight">
                  Creează cont
                </h1>

                <p className="mt-2 text-sm text-black/55">
                  Completează datele pentru a continua.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRegister();
                }}
                className="space-y-4"
              >
                <input
                  type="text"
                  placeholder={
                    role === "workshop" ? "Nume service" : "Nume afișare"
                  }
                  className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 outline-none focus:border-orange-400"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />

                <input
                  type="email"
                  placeholder="Adresa de email"
                  className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 outline-none focus:border-orange-400"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />

                <input
                  type="password"
                  placeholder="Parola"
                  className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 outline-none focus:border-orange-400"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Oraș"
                  className="w-full rounded-2xl border border-black/10 bg-black/[0.03] px-4 py-4 outline-none focus:border-orange-400"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />

                <label className="flex items-start gap-3 pt-2 text-sm text-black/65">
                  <input
                    type="checkbox"
                    checked={gdprAccepted}
                    onChange={(e) => setGdprAccepted(e.target.checked)}
                    className="mt-1 h-5 w-5"
                  />
                  <span>Accept Termenii și Condițiile și Politica GDPR.</span>
                </label>

                <div className="flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-black/10" />
                  <span className="text-xs text-black/40">sau</span>
                  <div className="h-px flex-1 bg-black/10" />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleRegister}
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border border-black/10 py-3.5 font-semibold text-black transition active:scale-[0.99]"
                >
                  <span className="text-xl font-black">G</span>
                  Continuă cu Google
                </button>

                <button
                  type="button"
                  disabled
                  className="flex w-full items-center justify-center gap-3 rounded-2xl border border-black/10 py-3.5 font-semibold text-black/35"
                >
                  <span className="text-xl"></span>
                  Continuă cu Apple
                </button>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-2xl bg-orange-500 py-4 font-bold text-white shadow-lg transition active:scale-[0.99] disabled:opacity-60"
                >
                  {loading ? "Se creează contul..." : "Creează cont"}
                </button>

                <div className="pt-3 text-center text-sm text-black/55">
                  Ai deja cont?{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/login")}
                    className="font-bold text-orange-500"
                  >
                    Intră în cont
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
