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
};

export function NetworksPanel({ busy, setBusy, refreshToken }: Props) {
  const [networks, setNetworks] = useState<NetworkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await networksList();
      setNetworks(result.networks || []);
      setRaw(result.stdout || result.stderr || "");
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
    void refresh();
  }, [refresh, refreshToken]);

  const withBusy = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const toggleNetwork = (net: NetworkEntry, selected: boolean) =>
    withBusy(async () => {
      const result = selected
        ? await networksSelect([net.id], true)
        : await networksDeselect([net.id]);
      if (!result.success) {
        toaster.toast({
          title: "Network update failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    });

  const selectAll = () =>
    withBusy(async () => {
      const result = await networksSelect(["all"]);
      if (!result.success) {
        toaster.toast({
          title: "Select all failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    });

  const deselectAll = () =>
    withBusy(async () => {
      const result = await networksDeselect(["all"]);
      if (!result.success) {
        toaster.toast({
          title: "Deselect all failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    });

  return (
    <PanelSection title="Networks">
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || loading} onClick={() => void refresh()}>
          {loading ? "Refreshing…" : "Refresh networks"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || loading} onClick={selectAll}>
          Select all
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || loading} onClick={deselectAll}>
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
            No networks found (connect first, or see raw output below)
          </Field>
        </PanelSectionRow>
      ) : null}
      {networks.map((net) => (
        <PanelSectionRow key={net.id}>
          <ToggleField
            label={net.id}
            description={net.description || net.raw || ""}
            checked={net.selected}
            disabled={busy || loading}
            onChange={(value) => void toggleNetwork(net, value)}
          />
        </PanelSectionRow>
      ))}
      {raw ? (
        <PanelSectionRow>
          <Field label="Raw list" focusable={false}>
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
              {raw}
            </pre>
          </Field>
        </PanelSectionRow>
      ) : null}
    </PanelSection>
  );
}
