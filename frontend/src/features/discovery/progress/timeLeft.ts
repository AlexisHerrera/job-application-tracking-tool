export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** "about 40s left", from how long the finished units took. */
export function eta(elapsed: number | null | undefined, done: number, total: number): string | null {
  if (!elapsed || done < 1 || done >= total) return null;
  const left = (elapsed / done) * (total - done);
  return left < 10 ? "a few seconds left" : `about ${duration(left)} left`;
}
