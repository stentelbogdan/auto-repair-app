import { ImageDiagnosticsProvider } from '@/lib/repair-requests/ImageDiagnosticsProvider';
import { targetedImageDiagnosticsEnabled } from '@/lib/supabase/targeted-image-diagnostics.server';

// Evaluate the server-only opt-in for this request, never bake it into a static page.
export const dynamic = 'force-dynamic';
export default function RequestEditorLayout({ children }: { children: React.ReactNode }) {
  return <ImageDiagnosticsProvider enabled={targetedImageDiagnosticsEnabled()}>{children}</ImageDiagnosticsProvider>;
}
