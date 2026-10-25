import { handleTargetedImageDeletionRequest } from "@/lib/supabase/targeted-repair-image-deletion-route";

export const runtime = "nodejs";
// Platform ceiling only; interrupted requests still require same-operation recovery.
export const maxDuration = 180;

export async function POST(request: Request) {
  return handleTargetedImageDeletionRequest(request);
}
// Explicit rejection also prevents implicit HEAD/OPTIONS behavior from bypassing
// the TEST Preview guard or the common no-store response policy.
export async function GET(request: Request) { return handleTargetedImageDeletionRequest(request); }
export async function HEAD(request: Request) { return handleTargetedImageDeletionRequest(request); }
export async function PUT(request: Request) { return handleTargetedImageDeletionRequest(request); }
export async function PATCH(request: Request) { return handleTargetedImageDeletionRequest(request); }
export async function DELETE(request: Request) { return handleTargetedImageDeletionRequest(request); }
export async function OPTIONS(request: Request) { return handleTargetedImageDeletionRequest(request); }
