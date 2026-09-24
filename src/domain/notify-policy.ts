export class NotifyPolicy {
  private last = new Map<string, number>();
  constructor(private windowMs = 300_000) {}

  allow(kind: string, now: number): boolean {
    const prev = this.last.get(kind);
    if (prev !== undefined && now - prev < this.windowMs) return false;
    this.last.set(kind, now);
    return true;
  }
}
