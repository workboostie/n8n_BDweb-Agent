"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel mx-auto mt-10 max-w-lg space-y-3 p-8 text-center">
      <p className="font-semibold">Something went wrong on this page.</p>
      <p className="text-sm break-words muted">{error.message || "Unknown error"}</p>
      <div className="flex justify-center gap-2">
        <button onClick={reset} className="btn btn-primary">
          Try again
        </button>
        <button onClick={() => location.reload()} className="btn btn-ghost">
          Reload page
        </button>
      </div>
    </div>
  );
}
