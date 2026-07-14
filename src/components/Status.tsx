import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Field,
} from "@decky/ui";
import { useState } from "react";
import type { PeerState, StatusResult } from "../types";

type Props = {
  status: StatusResult | null;
  onRefresh: () => Promise<void>;
  busy: boolean;
};

function asPeers(status: StatusResult | null): PeerState[] {
  const peers = status?.parsed?.peers;
  if (Array.isArray(peers)) return peers;
  if (peers && typeof peers === "object" && Array.isArray(peers.details)) {
    return peers.details;
  }
  return [];
}

function formatLatency(latency: string | number | undefined): string {
  if (latency == null || latency === "") return "";
  if (typeof latency === "number") {
    // Go encoding/json encodes time.Duration as nanoseconds
    if (latency >= 1_000_000) return `${Math.round(latency / 1_000_000)}ms`;
    if (latency > 0) return `${latency}ns`;
    return "";
  }
  return String(latency);
}

function boolish(value: unknown): string {
  if (typeof value === "boolean") return value ? "Connected" : "Disconnected";
  if (value == null) return "—";
  return String(value);
}

export function StatusPanel({ status, onRefresh, busy }: Props) {
  const [showRaw, setShowRaw] = useState(false);
  const parsed = status?.parsed;
  const peers = asPeers(status);

  return (
    <PanelSection title="Status detail">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={() => void onRefresh()}>
          Refresh status
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Daemon" focusable={false}>
          {status?.daemon_status || parsed?.daemonStatus || parsed?.status || "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Management" focusable={false}>
          {boolish(parsed?.management?.connected)}
          {parsed?.management?.url ? ` (${parsed.management.url})` : ""}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Signal" focusable={false}>
          {boolish(parsed?.signal?.connected)}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Relays" focusable={false}>
          {parsed?.relays
            ? `${parsed.relays.available ?? "?"}/${parsed.relays.total ?? "?"}`
            : "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Versions" focusable={false}>
          CLI {parsed?.cliVersion || "—"} / Daemon {parsed?.daemonVersion || "—"}
        </Field>
      </PanelSectionRow>
      {peers.length > 0 ? (
        <PanelSectionRow>
          <Field label={`Peers (${peers.length})`} focusable={false}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {peers.map((peer, idx) => {
                const name = peer.fqdn || peer.hostname || `peer-${idx}`;
                const ip = peer.netbirdIp || peer.ip || "—";
                const st = peer.status || peer.connectionStatus || "—";
                const kind =
                  peer.connectionType ||
                  peer.connType ||
                  (peer.direct ? "P2P" : "—");
                const latency = formatLatency(peer.latency);
                return (
                  <div
                    key={`${name}-${ip}-${idx}`}
                    style={{ fontSize: "12px", lineHeight: "1.3" }}
                  >
                    <strong>{name}</strong>
                    <br />
                    {ip} · {st} · {kind}
                    {latency ? ` · ${latency}` : ""}
                  </div>
                );
              })}
            </div>
          </Field>
        </PanelSectionRow>
      ) : null}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? "Hide raw detail" : "Show raw detail"}
        </ButtonItem>
      </PanelSectionRow>
      {showRaw ? (
        <PanelSectionRow>
          <Field label="Raw" focusable={false}>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "11px",
                margin: 0,
                maxHeight: "220px",
                overflow: "auto",
              }}
            >
              {status?.detail ||
                status?.stdout ||
                status?.stderr ||
                (parsed ? JSON.stringify(parsed, null, 2) : "No detail available")}
            </pre>
          </Field>
        </PanelSectionRow>
      ) : null}
    </PanelSection>
  );
}
