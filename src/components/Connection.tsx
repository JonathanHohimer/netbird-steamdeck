import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useState } from "react";
import { netbirdDown, netbirdUp } from "../api";
import type { StatusResult } from "../types";

type Props = {
  status: StatusResult | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  managementUrl: string;
  setupKey: string;
  onRefresh: () => Promise<void>;
  onAuthUrl: (url: string | null) => void;
};

function summarize(status: StatusResult | null): string {
  if (!status) return "Unknown";
  if (status.daemon_status) return String(status.daemon_status);
  if (status.parsed?.daemonStatus) return String(status.parsed.daemonStatus);
  if (status.parsed?.status) return String(status.parsed.status);
  if (!status.success && status.stderr) return "Unavailable";
  return status.connected ? "Connected" : "Disconnected";
}

function peerSummary(status: StatusResult | null): string {
  const parsed = status?.parsed;
  if (!parsed) return "—";
  const peers = parsed.peers;
  if (Array.isArray(peers)) {
    const connected = peers.filter((p) =>
      String(p.status || p.connectionStatus || "")
        .toLowerCase()
        .includes("connect")
    ).length;
    return `${connected}/${peers.length}`;
  }
  if (peers && typeof peers === "object") {
    if (typeof peers.connected === "number" && typeof peers.total === "number") {
      return `${peers.connected}/${peers.total}`;
    }
    if (Array.isArray(peers.details)) {
      const details = peers.details;
      const connected = details.filter((p) =>
        String(p.status || p.connectionStatus || "")
          .toLowerCase()
          .includes("connect")
      ).length;
      return `${connected}/${details.length}`;
    }
  }
  return "—";
}

export function ConnectionPanel({
  status,
  busy,
  setBusy,
  managementUrl,
  setupKey,
  onRefresh,
  onAuthUrl,
}: Props) {
  const [localBusy, setLocalBusy] = useState(false);
  const connected = Boolean(status?.connected);
  const ip = status?.parsed?.netbirdIp || "—";
  const fqdn = status?.parsed?.fqdn || "—";

  const setWorking = useCallback(
    (value: boolean) => {
      setLocalBusy(value);
      setBusy(value);
    },
    [setBusy]
  );

  const onToggle = async (wantUp: boolean) => {
    if (busy || localBusy) return;
    setWorking(true);
    try {
      if (wantUp) {
        const result = await netbirdUp(
          setupKey || "",
          managementUrl || "",
          true
        );
        if (result.auth_url) {
          onAuthUrl(result.auth_url);
          toaster.toast({
            title: "NetBird SSO",
            body: "Open the login URL shown below to finish authentication.",
          });
        }
        if (result.success) {
          toaster.toast({ title: "NetBird", body: "Connected" });
          onAuthUrl(null);
        } else if (!result.auth_url) {
          toaster.toast({
            title: "NetBird up failed",
            body: (result.stderr || result.stdout || "Unknown error").slice(
              0,
              120
            ),
          });
        }
      } else {
        const result = await netbirdDown();
        if (result.success) {
          toaster.toast({ title: "NetBird", body: "Disconnected" });
        } else {
          toaster.toast({
            title: "NetBird down failed",
            body: (result.stderr || result.stdout || "Unknown error").slice(
              0,
              120
            ),
          });
        }
      }
      await onRefresh();
    } finally {
      setWorking(false);
    }
  };

  return (
    <PanelSection title="Connection">
      <PanelSectionRow>
        <ToggleField
          label="Connected"
          description={
            busy || localBusy
              ? "Working…"
              : `Daemon: ${summarize(status)}`
          }
          checked={connected}
          disabled={busy || localBusy}
          onChange={onToggle}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="NetBird IP" focusable={false}>
          {ip}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="FQDN" focusable={false}>
          {fqdn}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Peers connected" focusable={false}>
          {peerSummary(status)}
        </Field>
      </PanelSectionRow>
    </PanelSection>
  );
}
