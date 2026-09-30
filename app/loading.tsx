function Skeleton({ className = '' }: { className?: string }) {
  return <span className={`ui-skeleton ${className}`} aria-hidden="true" />;
}

export default function Loading() {
  return (
    <main id="main-content" className="page-loading tool-page-content" aria-busy="true">
        <div className="tool-intro">
          <Skeleton className="h-3 w-36" />
          <Skeleton className="mt-5 h-12 w-[min(100%,620px)]" />
          <Skeleton className="mt-4 h-4 w-[min(100%,560px)]" />
          <Skeleton className="mt-2 h-4 w-[min(100%,420px)]" />
        </div>
        <section className="glass-panel tool-panel p-5 sm:p-7">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-6 h-11 w-full" />
          <Skeleton className="mt-4 h-48 w-full" />
        </section>
    </main>
  );
}
