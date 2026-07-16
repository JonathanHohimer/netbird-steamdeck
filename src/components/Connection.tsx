import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  Field,
  ButtonItem,
  Navigation,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useState } from "react";
import { fetchPublicIp, netbirdDown, netbirdUp } from "../api";
import type { StatusResult } from "../types";
import {
  boolish,
  nonDefaultManagementUrl,
  peerSummary,
} from "./statusHelpers";

type Props = {
  status: StatusResult | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  managementUrl: string;
  setupKey: string;
  onRefresh: () => Promise<void>;
  onAuthUrl: (url: string | null) => void;
  onOpenPeers: () => void;
  /** When true, interactive controls are disabled (e.g. NetBird not installed). */
  controlsDisabled?: boolean;
};

function summarize(status: StatusResult | null): string {
  if (!status) return "Unknown";
  if (status.daemon_status) return String(status.daemon_status);
  if (status.parsed?.daemonStatus) return String(status.parsed.daemonStatus);
  if (status.parsed?.status) return String(status.parsed.status);
  if (!status.success && status.stderr) return "Unavailable";
  return status.connected ? "Connected" : "Disconnected";
}

export function ConnectionPanel({
  status,
  busy,
  setBusy,
  managementUrl,
  setupKey,
  onRefresh,
  onAuthUrl,
  onOpenPeers,
  controlsDisabled = false,
}: Props) {
  const [localBusy, setLocalBusy] = useState(false);
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const connected = Boolean(status?.connected);
  const ip = status?.parsed?.netbirdIp || "—";
  const fqdn = status?.parsed?.fqdn || "—";
  const parsed = status?.parsed;
  const customMgmt = nonDefaultManagementUrl(status, managementUrl);
  const locked = controlsDisabled || busy || localBusy;

  const setWorking = useCallback(
    (value: boolean) => {
      setLocalBusy(value);
      setBusy(value);
    },
    [setBusy]
  );

  const onToggle = async (wantUp: boolean) => {
    if (controlsDisabled || busy || localBusy) return;
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
          try {
            Navigation.NavigateToExternalWeb(result.auth_url);
          } catch (e) {
            console.error(e);
          }
          toaster.toast({
            title: "NetBird SSO",
            body: "Finish login in the browser (URL also under Authentication).",
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

  const checkPublicIp = async () => {
    if (controlsDisabled || busy || localBusy) return;
    setWorking(true);
    try {
      const result = await fetchPublicIp();
      if (result.success && result.ip) {
        setPublicIp(result.ip);
        toaster.toast({ title: "Public IP", body: result.ip });
      } else {
        setPublicIp(null);
        toaster.toast({
          title: "Public IP check failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(
            0,
            120
          ),
        });
      }
    } catch (e) {
      setPublicIp(null);
      toaster.toast({
        title: "Public IP check failed",
        body: String(e).slice(0, 120),
      });
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
            controlsDisabled
              ? "Install NetBird first"
              : busy || localBusy
                ? "Working…"
                : `Daemon: ${summarize(status)}`
          }
          checked={connected}
          disabled={locked}
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
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onOpenPeers}>
          Peers →
        </ButtonItem>
      </PanelSectionRow>
      {customMgmt ? (
        <PanelSectionRow>
          <Field label="Management URL" focusable={false}>
            <div style={{ wordBreak: "break-all", fontSize: "12px" }}>
              {customMgmt}
            </div>
          </Field>
        </PanelSectionRow>
      ) : null}
      <PanelSectionRow>
        <Field label="Public IP (ifconfig.me)" focusable={false}>
          {publicIp || "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={locked}
          onClick={() => void checkPublicIp()}
        >
          Test public IP (curl ifconfig.me)
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={locked}
          onClick={() => void onRefresh()}
        >
          Refresh status
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Daemon" focusable={false}>
          {status?.daemon_status ||
            parsed?.daemonStatus ||
            parsed?.status ||
            "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Management" focusable={false}>
          {boolish(parsed?.management?.connected)}
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
          CLI {parsed?.cliVersion || "—"} / Daemon{" "}
          {parsed?.daemonVersion || "—"}
        </Field>
      </PanelSectionRow>
    </PanelSection>
  );
}
