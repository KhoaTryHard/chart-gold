export type LatestRequestGuard = {
  begin: () => number;
  isCurrent: (requestId: number) => boolean;
};

/** Tracks the request allowed to commit the latest UI state. */
export function createLatestRequestGuard(): LatestRequestGuard {
  let latestRequestId = 0;

  return {
    begin() {
      latestRequestId += 1;
      return latestRequestId;
    },
    isCurrent(requestId) {
      return requestId === latestRequestId;
    },
  };
}
