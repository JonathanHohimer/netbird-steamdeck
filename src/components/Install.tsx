import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useEffect, useState } from "react";
import {
  getInstallStatus,
  installNetbird,
  serviceStart,
  serviceStop,
  uninstallNetbird,
  updateNetbird,
} from "../api";
import type { BinaryInfo, InstallStatus } from "../types";

type Props = {
  binary: BinaryInfo | null;
  setBinary: (info: BinaryInfo | null) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
};

function isManaged(info: BinaryInfo | null | undefined): boolean {
  if (!info) return false;
  if (info.managed) return true;
  return Boolean(info.path && info.path.includes("/opt/netbird"));
}

export function InstallPanel({
  binary,
  setBinary,
  busy,
  setBusy,
  onRefresh,
}: Props) {
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [log, setLog] = useState("");
  const [loadingStatus, setLoadingStatus] = useState(false);

  const refresh = useCallback(async () => {
    setLoadingStatus(true);
    try {
      const info = await getInstallStatus();
      setStatus(info);
      setBinary(info);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStatus(false);
    }
  }, [setBinary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const withBusy = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const doInstall = () =>
    withBusy(async () => {
      toaster.toast({
        title: "NetBird",
        body: "Downloading and installing… this may take a minute.",
      });
      const result = await installNetbird("");
      setLog(
        [result.message, result.stderr].filter(Boolean).join("\n\n") || ""
      );
      if (result.success) {
        toaster.toast({
          title: "NetBird installed",
          body: result.version
            ? `v${result.version} at /opt/netbird`
            : "Installed under /opt/netbird",
        });
      } else {
        toaster.toast({
          title: "Install failed",
          body: (result.stderr || result.message || "Unknown error").slice(
            0,
            120
          ),
        });
      }
    });

  const doUpdate = () =>
    withBusy(async () => {
      toaster.toast({ title: "NetBird", body: "Updating…" });
      const result = await updateNetbird();
      setLog(
        [result.message, result.stderr].filter(Boolean).join("\n\n") || ""
      );
      if (result.success) {
        toaster.toast({
          title: "NetBird updated",
          body: result.version ? `Now on v${result.version}` : "Update complete",
        });
      } else {
        toaster.toast({
          title: "Update failed",
          body: (result.stderr || result.message || "Unknown error").slice(
            0,
            120
          ),
        });
      }
    });

  const doUninstall = () =>
    withBusy(async () => {
      const result = await uninstallNetbird();
      setLog(
        [result.message, result.stderr].filter(Boolean).join("\n\n") || ""
      );
      if (result.success) {
        toaster.toast({
          title: "NetBird",
          body: "Uninstalled from /opt/netbird",
        });
      } else {
        toaster.toast({
          title: "Uninstall failed",
          body: (result.stderr || result.message || "Unknown error").slice(
            0,
            120
          ),
        });
      }
    });

  const doService = (action: "start" | "stop") =>
    withBusy(async () => {
      const result =
        action === "start" ? await serviceStart() : await serviceStop();
      if (result.success) {
        toaster.toast({
          title: "NetBird",
          body: action === "start" ? "Service started" : "Service stopped",
        });
      } else {
        toaster.toast({
          title: `Service ${action} failed`,
          body: (result.stderr || result.stdout || "Unknown error").slice(
            0,
            120
          ),
        });
      }
    });

  const installed = Boolean(binary?.found || status?.found);
  const managed = isManaged(binary) || isManaged(status);
  const serviceActive = Boolean(
    binary?.service_active || status?.service_active
  );
  const enabledOnBoot = Boolean(
    binary?.service_enabled || status?.service_enabled
  );

  return (
    <PanelSection title="Install (Steam Deck)">
      <PanelSectionRow>
        <Field label="Plugin privileges" focusable={false}>
          {binary?.is_root || status?.is_root
            ? "root (can install to /opt)"
            : `NOT root (uid ${binary?.uid ?? status?.uid ?? "?"}) — reinstall zip with flags: ["root"]`}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Managed install" focusable={false}>
          {managed
            ? "Yes (/opt/netbird)"
            : installed
              ? "External install detected"
              : "Not installed"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Installed version" focusable={false}>
          {binary?.version || status?.version || "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Latest release" focusable={false}>
          {loadingStatus
            ? "Checking…"
            : status?.latest
              ? `v${status.latest}${
                  status.update_available ? " (update available)" : ""
                }`
              : status?.latest_error
                ? `Unavailable (${status.latest_error.slice(0, 40)})`
                : "—"}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label="Service" focusable={false}>
          {serviceActive ? "Active" : "Inactive"}
          {enabledOnBoot ? " · enabled on boot" : ""}
        </Field>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={doInstall}>
          {installed ? "Reinstall latest" : "Install NetBird"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy || !status?.update_available}
          onClick={doUpdate}
        >
          Update to latest
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy || !installed}
          onClick={() => void doService(serviceActive ? "stop" : "start")}
        >
          {serviceActive ? "Stop service" : "Start service"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || !managed} onClick={doUninstall}>
          Uninstall managed NetBird
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy || loadingStatus}
          onClick={() => void refresh()}
        >
          Refresh install status
        </ButtonItem>
      </PanelSectionRow>
      {log ? (
        <PanelSectionRow>
          <Field label="Install log" focusable={false}>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "11px",
                margin: 0,
                maxHeight: "160px",
                overflow: "auto",
              }}
            >
              {log}
            </pre>
          </Field>
        </PanelSectionRow>
      ) : null}
    </PanelSection>
  );
}
