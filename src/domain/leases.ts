export type LeaseSource = "manual" | "timed" | "game" | "call" | "input" | "test";

export type Lease = {
  id: string;
  source: LeaseSource;
  label: string;
  since: number;
  expiresAt?: number;
  /** True when the lease depends on sensor data (processes, input devices). */
  sensorBound: boolean;
};

export class LeaseSet {
  private leases = new Map<string, Lease>();

  add(l: Lease) {
    if (!this.leases.has(l.id)) this.leases.set(l.id, l);
  }

  remove(id: string) {
    this.leases.delete(id);
  }

  has(id: string) {
    return this.leases.has(id);
  }

  all(): Lease[] {
    return [...this.leases.values()];
  }

  active(now: number): Lease[] {
    for (const l of this.leases.values()) if (l.expiresAt !== undefined && now >= l.expiresAt) this.leases.delete(l.id);
    return [...this.leases.values()];
  }

  /** Sensor-bound leases end when the sensor has been silent longer than boundMs. */
  expireUnknown(now: number, lastSensorTs: number, boundMs: number): string[] {
    if (now - lastSensorTs <= boundMs) return [];
    const gone = [...this.leases.values()].filter((l) => l.sensorBound).map((l) => l.id);
    for (const id of gone) this.leases.delete(id);
    return gone;
  }
}
