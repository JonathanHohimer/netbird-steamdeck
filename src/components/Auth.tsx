import {
  PanelSection,
  PanelSectionRow,
  TextField,
  ButtonItem,
  Field,
  Navigation,
  ToggleField,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useEffect, useState } from "react";
import { netbirdLogin, netbirdLogout, netbirdUp } from "../api";

type Props = {
  connected: boolean;
  managementUrl: string;
  setupKey: string;
  setSetupKey: (key: string) => void;
  authUrl: string | null;
  setAuthUrl: (url: string | null) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onRefresh: () => Promise<void>;
};

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function openSsoUrl(url: string) {
  try {
    Navigation.NavigateToExternalWeb(url);
    return true;
  } catch (e) {
    console.error("NavigateToExternalWeb failed", e);
    return false;
  }
}

export function AuthPanel({
  connected,
  managementUrl,
  setupKey,
  setSetupKey,
  authUrl,
  setAuthUrl,
  busy,
  setBusy,
  onRefresh,
}: Props) {
  const [ssoLog, setSsoLog] = useState("");
  const [showQr, setShowQr] = useState(true);

  useEffect(() => {
    if (connected) {
      setSsoLog("");
      setAuthUrl(null);
    }
  }, [connected, setAuthUrl]);

  const withBusy = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const connectWithKey = () =>
    withBusy(async () => {
      if (!setupKey.trim()) {
        toaster.toast({
          title: "Setup key required",
          body: "Enter a setup key first.",
        });
        return;
      }
      const result = await netbirdUp(
        setupKey.trim(),
        managementUrl.trim(),
        false,
        false
      );
      if (result.success) {
        toaster.toast({ title: "NetBird", body: "Connected with setup key" });
        setAuthUrl(null);
        setSetupKey("");
      } else {
        toaster.toast({
          title: "Connect failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    });

  const ssoLogin = () =>
    withBusy(async () => {
      const result = await netbirdLogin(
        "",
        managementUrl.trim(),
        true,
        showQr
      );
      const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
      setSsoLog(combined);
      if (result.auth_url) {
        setAuthUrl(result.auth_url);
        if (!showQr) {
          openSsoUrl(result.auth_url);
        }
        toaster.toast({
          title: "SSO login",
          body: showQr
            ? "Scan the QR below with another device (or copy the URL)."
            : "Opened Steam browser — or copy the URL for another device.",
        });
      } else if (result.success) {
        toaster.toast({ title: "NetBird", body: "Login succeeded" });
        setAuthUrl(null);
      } else {
        toaster.toast({
          title: "SSO login — no URL yet",
          body: "See SSO output below. Ensure the service is running, then retry.",
        });
      }
    });

  const doLogout = () =>
    withBusy(async () => {
      const result = await netbirdLogout();
      if (result.success) {
        toaster.toast({ title: "NetBird", body: "Logged out" });
        setAuthUrl(null);
      } else {
        toaster.toast({
          title: "Logout failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    });

  return (
    <PanelSection title="Authentication">
      {!connected ? (
        <>
          <PanelSectionRow>
            <TextField
              label="Setup key"
              description="Used for Connect with setup key (not saved)"
              value={setupKey}
              disabled={busy}
              onChange={(e) => setSetupKey(e.target.value)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={connectWithKey}>
              Connect with setup key
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label="Show QR for SSO"
              description="Uses netbird --qr so another device can scan the login URL"
              checked={showQr}
              disabled={busy}
              onChange={setShowQr}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={busy} onClick={ssoLogin}>
              SSO login
            </ButtonItem>
          </PanelSectionRow>
        </>
      ) : null}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={doLogout}>
          Logout
        </ButtonItem>
      </PanelSectionRow>
      {authUrl && !connected ? (
        <>
          <PanelSectionRow>
            <Field label="SSO URL" focusable={true}>
              <div
                style={{
                  wordBreak: "break-all",
                  fontSize: "12px",
                  lineHeight: "1.3",
                  userSelect: "text",
                }}
              >
                {authUrl}
              </div>
            </Field>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={() => {
                const ok = openSsoUrl(authUrl);
                toaster.toast({
                  title: "NetBird",
                  body: ok ? "Opened in Steam browser" : "Could not open browser",
                });
              }}
            >
              Open SSO URL
            </ButtonItem>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={async () => {
                const ok = await copyText(authUrl);
                toaster.toast({
                  title: "NetBird",
                  body: ok ? "URL copied" : "Could not copy URL",
                });
              }}
            >
              Copy SSO URL
            </ButtonItem>
          </PanelSectionRow>
        </>
      ) : null}
      {ssoLog && !connected ? (
        <PanelSectionRow>
          <div
            style={{
              width: "100%",
              marginTop: "4px",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                opacity: 0.85,
                marginBottom: "4px",
              }}
            >
              {showQr ? "SSO QR / output" : "SSO output"}
            </div>
            <div
              style={{
                width: "100%",
                overflowX: "auto",
                overflowY: "auto",
                maxHeight: "420px",
                background: "#000",
                padding: "6px 4px",
              }}
            >
              <pre
                style={{
                  whiteSpace: "pre",
                  wordBreak: "normal",
                  overflow: "visible",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  fontSize: "5.5px",
                  lineHeight: "1.0",
                  letterSpacing: "0",
                  margin: 0,
                  padding: 0,
                  color: "#fff",
                  userSelect: "text",
                  display: "inline-block",
                  minWidth: "100%",
                }}
              >
                {ssoLog}
              </pre>
            </div>
          </div>
        </PanelSectionRow>
      ) : null}
    </PanelSection>
  );
}
