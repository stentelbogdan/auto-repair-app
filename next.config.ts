import type { NextConfig } from "next";

import {
  assertSupabaseProjectUrl,
  expectedProjectRefForVercelEnvironment,
  supabaseProjectRefFromUrl,
} from "./lib/supabase/project-boundary";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const vercelEnvironment = process.env.VERCEL_ENV;
const environmentProjectRef =
  expectedProjectRefForVercelEnvironment(vercelEnvironment);

let expectedSupabaseProjectRef: string;

if (environmentProjectRef) {
  assertSupabaseProjectUrl(supabaseUrl, environmentProjectRef);
  expectedSupabaseProjectRef = environmentProjectRef;
} else if (process.env.NODE_ENV === "development") {
  const localProjectRef = process.env.AUTOREPAIR_LOCAL_SUPABASE_PROJECT_REF;
  if (!localProjectRef) {
    throw new Error("AUTOREPAIR_LOCAL_SUPABASE_PROJECT_REF is missing");
  }
  assertSupabaseProjectUrl(supabaseUrl, localProjectRef);
  expectedSupabaseProjectRef = localProjectRef;
} else {
  if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing");
  expectedSupabaseProjectRef = supabaseProjectRefFromUrl(supabaseUrl);
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF:
      expectedSupabaseProjectRef,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ouoiykudvcoqbkybkqvs.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "bstjobvvxxfqqwyjoimx.supabase.co",
        port: "",
        pathname: "/storage/v1/object/public/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
