import {
  PanelSection,
  PanelSectionRow,
  TextField,
  ButtonItem,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useEffect, useState } from "react";
import {
  getInstallStatus,
  networksList,
  setManagementUrl,
} from "../api";
import type { BinaryInfo, StatusResult } from "../types";
import { CliRunnerPanel } from "./CliRunner";
import { DEFAULT_MANAGEMENT_URL, formatStatusRaw } from "./statusHelpers";

type Props = {
  managementUrl: string;
  setManagementUrlState: (url: string) => void;
  status: StatusResult | null;
  binary: BinaryInfo | null;
  busy: boolean;
  setBusy: (busy: boolean) => void;
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

export function AdvancedPanel({
  managementUrl,
  setManagementUrlState,
  status,
  binary,
  busy,
  setBusy,
}: Props) {
  const [urlDraft, setUrlDraft] = useState(managementUrl);
  const [savingUrl, setSavingUrl] = useState(false);
  const [installLog, setInstallLog] = useState("");
  const [networksRaw, setNetworksRaw] = useState("");
  const [loadingExtras, setLoadingExtras] = useState(false);

  useEffect(() => {
    setUrlDraft(managementUrl);
  }, [managementUrl]);

  const refreshExtras = useCallback(async () => {
    setLoadingExtras(true);
    try {
      const [install, nets] = await Promise.all([
        getInstallStatus(),
        networksList(),
      ]);
      setInstallLog(install.last_install_log || "");
      setNetworksRaw(
        [nets.stdout, nets.stderr].filter(Boolean).join("\n\n") || ""
      );
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingExtras(false);
    }
  }, []);

  useEffect(() => {
    void refreshExtras();
  }, [refreshExtras]);

  const saveUrl = async () => {
    setSavingUrl(true);
    try {
      const saved = await setManagementUrl(urlDraft.trim());
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

  const statusRaw = formatStatusRaw(status);

  return (
    <>
      <PanelSection title="Management URL">
        <PanelSectionRow>
          <TextField
            label="Management URL"
            description={`Leave empty for NetBird Cloud (${DEFAULT_MANAGEMENT_URL})`}
            value={urlDraft}
            disabled={busy || savingUrl}
            onChange={(e) => setUrlDraft(e.target.value)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || savingUrl}
            onClick={() => void saveUrl()}
          >
            Save management URL
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Install log">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            disabled={busy || loadingExtras}
            onClick={() => void refreshExtras()}
          >
            {loadingExtras ? "Refreshing…" : "Refresh logs / raw lists"}
          </ButtonItem>
        </PanelSectionRow>
        <PanelSectionRow>
          <Field label="Log" focusable={true}>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "11px",
                margin: 0,
                maxHeight: "360px",
                overflow: "auto",
                userSelect: "text",
              }}
            >
              {installLog ||
                "(no install log yet — run Install / Update under Service management)"}
            </pre>
          </Field>
        </PanelSectionRow>
        {installLog ? (
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={async () => {
                const ok = await copyText(installLog);
                toaster.toast({
                  title: "NetBird",
                  body: ok ? "Install log copied" : "Could not copy log",
                });
              }}
            >
              Copy install log
            </ButtonItem>
          </PanelSectionRow>
        ) : null}
      </PanelSection>

      <PanelSection title="Networks raw list">
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
              {networksRaw || "(empty — refresh or connect first)"}
            </pre>
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="Status raw detail">
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
              {statusRaw}
            </pre>
          </Field>
        </PanelSectionRow>
      </PanelSection>

      <CliRunnerPanel busy={busy} setBusy={setBusy} binary={binary} />
    </>
  );
}
