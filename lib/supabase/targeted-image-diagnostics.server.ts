// Server callers only. Browser imports must use the provider/pure vocabulary.
// @ts-expect-error TS5097: source extension for local Node tests.
import { assertSupabaseProjectUrl, TEST_SUPABASE_PROJECT_REF } from './project-boundary.ts';
// @ts-expect-error TS5097: source extension for local Node tests.
import { createImageDiagnostic } from '../repair-requests/image-deletion-diagnostics.ts';
export function targetedImageDiagnosticsEnabled(): boolean {
  if (typeof window !== 'undefined' || process.env.VERCEL_ENV !== 'preview' ||
      process.env.TARGETED_IMAGE_DIAGNOSTICS_ENABLED !== 'true') return false;
  try {
    assertSupabaseProjectUrl(process.env.SUPABASE_URL, TEST_SUPABASE_PROJECT_REF);
    assertSupabaseProjectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL, TEST_SUPABASE_PROJECT_REF);
    return process.env.NEXT_PUBLIC_AUTOREPAIR_SUPABASE_PROJECT_REF === TEST_SUPABASE_PROJECT_REF;
  } catch { return false; }
}
export function createTargetedImageDiagnostic() {
  return createImageDiagnostic(targetedImageDiagnosticsEnabled(), (...args) => console.info(...args));
}
