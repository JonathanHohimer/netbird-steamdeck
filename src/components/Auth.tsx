import {
  PanelSection,
  PanelSectionRow,
  TextField,
  ButtonItem,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useState } from "react";
import {
  netbirdLogin,
  netbirdLogout,
  netbirdUp,
  setManagementUrl,
} from "../api";

type Props = {
  managementUrl: string;
  setManagementUrlState: (url: string) => void;
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

export function AuthPanel({
  managementUrl,
  setManagementUrlState,
  setupKey,
  setSetupKey,
  authUrl,
  setAuthUrl,
  busy,
  setBusy,
  onRefresh,
}: Props) {
  const [savingUrl, setSavingUrl] = useState(false);

  const saveUrl = async () => {
    setSavingUrl(true);
    try {
      const saved = await setManagementUrl(managementUrl.trim());
      setManagementUrlState(saved.management_url || "");
      toaster.toast({
        title: "NetBird",
        body: saved.management_url
          ? "Management URL saved"
          : "Using NetBird Cloud default",
      });
    } finally {
      setSavingUrl(false);
    }
  };

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
      const result = await netbirdUp(setupKey.trim(), managementUrl.trim(), false);
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
      const result = await netbirdLogin("", managementUrl.trim(), true);
      if (result.auth_url) {
        setAuthUrl(result.auth_url);
        toaster.toast({
          title: "SSO login",
          body: "Open or copy the URL below to authenticate.",
        });
      }
      if (result.success) {
        toaster.toast({ title: "NetBird", body: "Login succeeded" });
        setAuthUrl(null);
      } else if (!result.auth_url) {
        toaster.toast({
          title: "Login failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
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
      <PanelSectionRow>
        <TextField
          label="Management URL"
          description="Leave empty for NetBird Cloud (https://api.netbird.io:443)"
          value={managementUrl}
          disabled={busy || savingUrl}
          onChange={(e) => setManagementUrlState(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || savingUrl} onClick={saveUrl}>
          Save management URL
        </ButtonItem>
      </PanelSectionRow>
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
        <ButtonItem layout="below" disabled={busy} onClick={ssoLogin}>
          SSO login
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={doLogout}>
          Logout
        </ButtonItem>
      </PanelSectionRow>
      {authUrl ? (
        <>
          <PanelSectionRow>
            <Field label="SSO URL" focusable={false}>
              <div
                style={{
                  wordBreak: "break-all",
                  fontSize: "12px",
                  lineHeight: "1.3",
                }}
              >
                {authUrl}
              </div>
            </Field>
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
    </PanelSection>
  );
}
