import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md", className)}
      style={{ backgroundColor: 'var(--app-subtle)' }}
      {...props}
    />
  )
}

// ── Variant Skeletons ──────────────────────────────────────────────────

/** Card-shaped skeleton — simulates a metric card or info card */
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border p-5 space-y-3", className)} style={{ borderColor: 'var(--app-border)' }}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-24 rounded-lg" />
        <Skeleton className="h-6 w-6 rounded-lg" />
      </div>
      <Skeleton className="h-8 w-32 rounded-lg" />
      <Skeleton className="h-3 w-20 rounded-lg" />
    </div>
  )
}

/** Table row skeleton — simulates a row with multiple cells */
function SkeletonTableRow({ columns = 6, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 px-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-4 rounded-lg",
            i === 0 ? "w-20" : i === columns - 1 ? "w-16" : "w-14"
          )}
        />
      ))}
    </div>
  )
}

/** Chart area skeleton — simulates a chart or graph area */
function SkeletonChart({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border p-4", className)} style={{ borderColor: 'var(--app-border)' }}>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-4 w-28 rounded-lg" />
        <Skeleton className="h-7 w-20 rounded-lg" />
      </div>
      <Skeleton className="h-48 w-full rounded-lg" />
    </div>
  )
}

/** Metric skeleton — small rectangle with a number placeholder */
function SkeletonMetric({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Skeleton className="h-3 w-16 rounded-lg" />
      <Skeleton className="h-7 w-24 rounded-lg" />
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonTableRow, SkeletonChart, SkeletonMetric }
