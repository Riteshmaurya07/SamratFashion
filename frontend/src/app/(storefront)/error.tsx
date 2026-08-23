"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-20 flex flex-col items-center justify-center min-h-[50vh]">
      <div className="w-20 h-20 bg-error-container rounded-full flex items-center justify-center mb-6">
        <AlertCircle className="w-10 h-10 text-error" />
      </div>
      <h1 className="font-display-lg text-on-surface mb-4">Unable to load data</h1>
      <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-md">
        We encountered an unexpected error while trying to fetch the catalog. Please try again.
      </p>
      <button
        onClick={() => reset()}
        className="px-8 py-3 bg-primary text-on-primary rounded font-label-caps font-bold transition-transform hover:scale-105 active:scale-95 shadow-md"
      >
        Try Again
      </button>
    </main>
  );
}
