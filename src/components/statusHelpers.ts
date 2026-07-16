import type { PeerState, StatusResult } from "../types";

export const DEFAULT_MANAGEMENT_URL = "https://api.netbird.io:443";

export function asPeers(status: StatusResult | null): PeerState[] {
  const peers = status?.parsed?.peers;
  if (Array.isArray(peers)) return peers;
  if (peers && typeof peers === "object" && Array.isArray(peers.details)) {
    return peers.details;
  }
  return [];
}

export function formatLatency(latency: string | number | undefined): string {
  if (latency == null || latency === "") return "";
  if (typeof latency === "number") {
    if (latency >= 1_000_000) return `${Math.round(latency / 1_000_000)}ms`;
    if (latency > 0) return `${latency}ns`;
    return "";
  }
  return String(latency);
}

export function boolish(value: unknown): string {
  if (typeof value === "boolean") return value ? "Connected" : "Disconnected";
  if (value == null) return "—";
  return String(value);
}

/** Return a non-default management URL to display, or null to hide. */
export function nonDefaultManagementUrl(
  status: StatusResult | null,
  savedUrl: string
): string | null {
  const fromStatus = (status?.parsed?.management?.url || "").trim();
  const fromSaved = (savedUrl || "").trim();
  const candidate = fromStatus || fromSaved;
  if (!candidate) return null;
  const normalized = candidate.replace(/\/$/, "").toLowerCase();
  const defaults = [
    DEFAULT_MANAGEMENT_URL.toLowerCase(),
    "https://api.netbird.io",
    "http://api.netbird.io:443",
    "http://api.netbird.io",
  ];
  if (defaults.includes(normalized)) return null;
  return candidate;
}

export function formatStatusRaw(status: StatusResult | null): string {
  if (!status) return "No detail available";
  if (status.detail?.trim()) return status.detail;
  if (status.stdout?.trim()) return status.stdout;
  if (status.stderr?.trim()) return status.stderr;
  if (status.parsed) return JSON.stringify(status.parsed, null, 2);
  return "No detail available";
}
