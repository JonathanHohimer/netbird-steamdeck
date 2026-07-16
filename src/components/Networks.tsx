import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  ButtonItem,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useEffect, useState } from "react";
import {
  networksDeselect,
  networksList,
  networksSelect,
} from "../api";
import type { NetworkEntry } from "../types";

type Props = {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  refreshToken: number;
  controlsDisabled?: boolean;
};

export function NetworksPanel({
  busy,
  setBusy,
  refreshToken,
  controlsDisabled = false,
}: Props) {
  const [networks, setNetworks] = useState<NetworkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = controlsDisabled || busy || loading;

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await networksList();
      setNetworks(result.networks || []);
      if (!result.success && !(result.networks || []).length) {
        setError(result.stderr || result.stdout || "Failed to list networks");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (controlsDisabled) return;
    void refresh();
  }, [refresh, refreshToken, controlsDisabled]);

  const withBusy = async (fn: () => Promise<void>) => {
    if (controlsDisabled || busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const resultMessage = (result: unknown): string => {
    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
      const r = result as { stderr?: string; stdout?: string; success?: boolean };
      return (r.stderr || r.stdout || "Unknown error").slice(0, 160);
    }
    return "Unknown error";
  };

  const toggleNetwork = (net: NetworkEntry, selected: boolean) =>
    withBusy(async () => {
      // Pass a plain string id (not a one-element array) for safer Decky IPC.
      const result = selected
        ? await networksSelect(net.id, true)
        : await networksDeselect(net.id);
      if (typeof result === "string" || !result?.success) {
        toaster.toast({
          title: "Network update failed",
          body: resultMessage(result),
        });
      }
    });

  const selectAll = () =>
    withBusy(async () => {
      const result = await networksSelect("all");
      if (typeof result === "string" || !result?.success) {
        toaster.toast({
          title: "Select all failed",
          body: resultMessage(result),
        });
      }
    });

  const deselectAll = () =>
    withBusy(async () => {
      const result = await networksDeselect("all");
      if (typeof result === "string" || !result?.success) {
        toaster.toast({
          title: "Deselect all failed",
          body: resultMessage(result),
        });
      }
    });

  return (
    <PanelSection title="Networks">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={locked} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : "Refresh networks"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={locked} onClick={selectAll}>
          Select all
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={locked} onClick={deselectAll}>
          Deselect all
        </ButtonItem>
      </PanelSectionRow>
      {error ? (
        <PanelSectionRow>
          <Field label="Error" focusable={false}>
            {error}
          </Field>
        </PanelSectionRow>
      ) : null}
      {networks.length === 0 && !loading ? (
        <PanelSectionRow>
          <Field label="Networks" focusable={false}>
            {controlsDisabled
              ? "Install NetBird first"
              : "No networks found (connect first)"}
          </Field>
        </PanelSectionRow>
      ) : null}
      {networks.map((net) => (
        <PanelSectionRow key={net.id}>
          <ToggleField
            label={net.id}
            description={net.description || net.raw || ""}
            checked={net.selected}
            disabled={locked}
            onChange={(value) => void toggleNetwork(net, value)}
          />
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}
