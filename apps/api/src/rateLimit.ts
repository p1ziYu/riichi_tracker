export const JOIN_CODE_TOTAL_LIMIT = 60;
export const JOIN_CODE_TOTAL_WINDOW_MS = 60_000;
export const JOIN_CODE_FAILURE_LIMIT = 10;
export const JOIN_CODE_FAILURE_WINDOW_MS = 600_000;

interface Bucket {
  requests: number[];
  failures: number[];
  lastSeen: number;
}

function discardExpired(timestamps: number[], cutoff: number): void {
  let expired = 0;
  while (expired < timestamps.length && timestamps[expired] <= cutoff) expired++;
  if (expired) timestamps.splice(0, expired);
}

export class JoinCodeRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  // Null means permitted; a number is the Retry-After delay in whole seconds.
  check(ip: string, now = Date.now()): number | null {
    if (now - this.lastSweep >= JOIN_CODE_TOTAL_WINDOW_MS) {
      for (const [key, bucket] of this.buckets) {
        if (now - bucket.lastSeen >= JOIN_CODE_FAILURE_WINDOW_MS) this.buckets.delete(key);
      }
      this.lastSweep = now;
    }
    let bucket = this.buckets.get(ip);
    if (!bucket) {
      bucket = { requests: [], failures: [], lastSeen: now };
      this.buckets.set(ip, bucket);
    }
    bucket.lastSeen = now;
    discardExpired(bucket.requests, now - JOIN_CODE_TOTAL_WINDOW_MS);
    discardExpired(bucket.failures, now - JOIN_CODE_FAILURE_WINDOW_MS);
    if (bucket.requests.length >= JOIN_CODE_TOTAL_LIMIT) {
      return Math.max(1, Math.ceil((bucket.requests[0] + JOIN_CODE_TOTAL_WINDOW_MS - now) / 1000));
    }
    bucket.requests.push(now);
    return null;
  }

  // Called only for an otherwise-404 lookup. Valid codes never spend the failure budget.
  recordFailure(ip: string, now = Date.now()): number | null {
    const failures = this.buckets.get(ip)!.failures;
    discardExpired(failures, now - JOIN_CODE_FAILURE_WINDOW_MS);
    if (failures.length >= JOIN_CODE_FAILURE_LIMIT) {
      return Math.max(1, Math.ceil((failures[0] + JOIN_CODE_FAILURE_WINDOW_MS - now) / 1000));
    }
    failures.push(now);
    return null;
  }
}
