import type { Alert } from "./types.js";

/// Same caveat as checkpointStore.ts: in-memory, resets on restart. Capped at
/// MAX_ALERTS so a long-running process (or a busy scan history) can't grow
/// this unboundedly — another small, deliberate memory-footprint choice.
/// Replace with a Postgres-backed alerts table when persistence lands.
const MAX_ALERTS = 500;

class AlertLog {
  private alerts: Alert[] = [];

  add(newAlerts: Alert[]): void {
    this.alerts.push(...newAlerts);
    if (this.alerts.length > MAX_ALERTS) {
      this.alerts = this.alerts.slice(this.alerts.length - MAX_ALERTS);
    }
  }

  recent(limit = 50): Alert[] {
    return this.alerts.slice(-limit).reverse();
  }
}

export const alertLog = new AlertLog();
