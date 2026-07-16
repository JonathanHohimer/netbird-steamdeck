import { PanelSection, PanelSectionRow, Field, ButtonItem, staticClasses } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaNetworkWired } from "react-icons/fa";
import { getBinaryInfo, getSettings, getStatus } from "./api";
import { AdvancedPanel } from "./components/Advanced";
import { AuthPanel } from "./components/Auth";
import { ConnectionPanel } from "./components/Connection";
import { InstallPanel } from "./components/Install";
import { NetworksPanel } from "./components/Networks";
import { PeersPanel } from "./components/Peers";
import type { BinaryInfo, StatusResult } from "./types";

type View = "main" | "service" | "advanced" | "peers";

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onBack}>
          ← Back
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}

function Content() {
  const [view, setView] = useState<View>("main");
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
    try {
      setBinary(await getBinaryInfo());
    } catch (e) {
      console.error(e);
    }
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

  const connected = Boolean(status?.connected);
  const installed = Boolean(binary?.found);
  const controlsDisabled = binary != null && !installed;
  const wasConnected = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnected.current) {
      // Freshly connected (incl. after SSO finishes) — refresh networks & clear SSO UI.
      setRefreshToken((n) => n + 1);
      setAuthUrl(null);
    }
    wasConnected.current = connected;
  }, [connected]);

  if (view === "service") {
    return (
      <>
        <BackRow onBack={() => setView("main")} />
        <InstallPanel
          binary={binary}
          setBinary={setBinary}
          busy={busy}
          setBusy={setBusy}
          onRefresh={refreshAll}
        />
      </>
    );
  }

  if (view === "advanced") {
    return (
      <>
        <BackRow onBack={() => setView("main")} />
        <AdvancedPanel
          managementUrl={managementUrl}
          setManagementUrlState={setManagementUrl}
          status={status}
          binary={binary}
          busy={busy}
          setBusy={setBusy}
        />
      </>
    );
  }

  if (view === "peers") {
    return (
      <>
        <BackRow onBack={() => setView("main")} />
        <PeersPanel status={status} />
      </>
    );
  }

  return (
    <>
      {controlsDisabled ? (
        <PanelSection title="NetBird isn’t installed yet">
          <PanelSectionRow>
            <Field label="" focusable={false}>
              Install from Service management to connect and manage networks.
            </Field>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={() => setView("service")}>
              Open Service management →
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      ) : null}

      <ConnectionPanel
        status={status}
        busy={busy}
        setBusy={setBusy}
        managementUrl={managementUrl}
        setupKey={setupKey}
        onRefresh={refreshAll}
        onAuthUrl={setAuthUrl}
        onOpenPeers={() => setView("peers")}
        controlsDisabled={controlsDisabled}
      />

      <AuthPanel
        connected={connected}
        managementUrl={managementUrl}
        setupKey={setupKey}
        setSetupKey={setSetupKey}
        authUrl={authUrl}
        setAuthUrl={setAuthUrl}
        busy={busy}
        setBusy={setBusy}
        onRefresh={refreshAll}
        controlsDisabled={controlsDisabled}
      />

      <NetworksPanel
        busy={busy}
        setBusy={setBusy}
        refreshToken={refreshToken}
        controlsDisabled={controlsDisabled}
      />

      <PanelSection title="More">
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setView("service")}>
            Service management →
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setView("advanced")}>
            Advanced →
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
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
