import { Suspense } from "react";
import ReviewContent from "./ReviewContent";

export default function ReviewPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-black px-6 py-10 text-white">
          <div className="mx-auto flex min-h-[60vh] max-w-4xl items-center justify-center">
            <p className="text-white/70">Loading review...</p>
          </div>
        </main>
      }
    >
      <ReviewContent />
    </Suspense>
  );
}