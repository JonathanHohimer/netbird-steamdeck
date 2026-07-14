import { PanelSection, PanelSectionRow, Field, staticClasses } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { useCallback, useEffect, useState } from "react";
import { FaNetworkWired } from "react-icons/fa";
import { getBinaryInfo, getSettings, getStatus } from "./api";
import { AuthPanel } from "./components/Auth";
import { CliRunnerPanel } from "./components/CliRunner";
import { ConnectionPanel } from "./components/Connection";
import { NetworksPanel } from "./components/Networks";
import { StatusPanel } from "./components/Status";
import type { BinaryInfo, StatusResult } from "./types";

function Content() {
  const [status, setStatus] = useState<StatusResult | null>(null);
  const [binary, setBinary] = useState<BinaryInfo | null>(null);
  const [managementUrl, setManagementUrl] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  const refreshStatus = useCallback(async () => {
    try {
      const result = await getStatus(true);
      setStatus(result);
    } catch (e) {
      console.error("status refresh failed", e);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await refreshStatus();
    setRefreshToken((n) => n + 1);
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [info, settings] = await Promise.all([
          getBinaryInfo(),
          getSettings(),
        ]);
        if (cancelled) return;
        setBinary(info);
        setManagementUrl(settings.management_url || "");
      } catch (e) {
        console.error("init failed", e);
      }
      if (!cancelled) await refreshStatus();
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshStatus]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!busy) void refreshStatus();
    }, 4000);
    return () => window.clearInterval(id);
  }, [busy, refreshStatus]);

  return (
    <>
      <PanelSection title="NetBird">
        <PanelSectionRow>
          <Field label="CLI" focusable={false}>
            {binary == null
              ? "Checking…"
              : binary.found
                ? `${binary.path}${binary.version ? ` (${binary.version})` : ""}`
                : "Not found — install NetBird first"}
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <ConnectionPanel
        status={status}
        busy={busy}
        setBusy={setBusy}
        managementUrl={managementUrl}
        setupKey={setupKey}
        onRefresh={refreshAll}
        onAuthUrl={setAuthUrl}
      />

      <AuthPanel
        managementUrl={managementUrl}
        setManagementUrlState={setManagementUrl}
        setupKey={setupKey}
        setSetupKey={setSetupKey}
        authUrl={authUrl}
        setAuthUrl={setAuthUrl}
        busy={busy}
        setBusy={setBusy}
        onRefresh={refreshAll}
      />

      <NetworksPanel
        busy={busy}
        setBusy={setBusy}
        refreshToken={refreshToken}
      />

      <StatusPanel status={status} onRefresh={refreshAll} busy={busy} />

      <CliRunnerPanel busy={busy} setBusy={setBusy} />
    </>
  );
}

export default definePlugin(() => {
  console.log("NetBird plugin initializing");

  return {
    name: "NetBird",
    titleView: <div className={staticClasses.Title}>NetBird</div>,
    content: <Content />,
    icon: <FaNetworkWired />,
    onDismount() {
      console.log("NetBird plugin unloading");
    },
  };
});
