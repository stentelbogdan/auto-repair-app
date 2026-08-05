export type JobWithActivityDate = {
  appointment?: {
    updated_at?: string | null;
  } | null;

  createdAt?: string | null;

  request?: {
    created_at?: string | null;
    createdAt?: string | null;
  };
};

function getValidTimestamp(value?: string | null): number {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

/*
 * Sortează lucrările după cea mai recentă activitate relevantă:
 *
 * 1. actualizarea programării;
 * 2. crearea/acceptarea ofertei;
 * 3. crearea cererii.
 *
 * Funcția nu modifică array-ul original.
 */
export function sortJobsByLatestActivity<
  T extends JobWithActivityDate,
>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const aTimestamp = Math.max(
      getValidTimestamp(a.appointment?.updated_at),
      getValidTimestamp(a.createdAt),
      getValidTimestamp(a.request?.createdAt),
      getValidTimestamp(a.request?.created_at),
    );

    const bTimestamp = Math.max(
      getValidTimestamp(b.appointment?.updated_at),
      getValidTimestamp(b.createdAt),
      getValidTimestamp(b.request?.createdAt),
      getValidTimestamp(b.request?.created_at),
    );

    return bTimestamp - aTimestamp;
  });
}