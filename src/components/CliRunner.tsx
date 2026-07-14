import {
  PanelSection,
  PanelSectionRow,
  TextField,
  ButtonItem,
  Field,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useState } from "react";
import { runCommand } from "../api";

type Props = {
  busy: boolean;
  setBusy: (busy: boolean) => void;
};

export function CliRunnerPanel({ busy, setBusy }: Props) {
  const [args, setArgs] = useState("version");
  const [output, setOutput] = useState("");

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await runCommand(args.trim());
      const text = [
        result.success ? `exit ${result.code}` : `FAILED (exit ${result.code})`,
        result.stdout?.trim() ? `--- stdout ---\n${result.stdout.trim()}` : "",
        result.stderr?.trim() ? `--- stderr ---\n${result.stderr.trim()}` : "",
        result.auth_url ? `--- auth url ---\n${result.auth_url}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      setOutput(text || "(no output)");
      if (!result.success) {
        toaster.toast({
          title: "Command failed",
          body: (result.stderr || result.stdout || "Unknown error").slice(0, 120),
        });
      }
    } catch (e) {
      setOutput(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection title="Advanced / CLI">
      <PanelSectionRow>
        <TextField
          label="netbird arguments"
          description='Example: status --detail   or   networks list'
          value={args}
          disabled={busy}
          onChange={(e) => setArgs(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy || !args.trim()} onClick={() => void run()}>
          {busy ? "Running…" : "Run command"}
        </ButtonItem>
      </PanelSectionRow>
      {output ? (
        <PanelSectionRow>
          <Field label="Output" focusable={false}>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "11px",
                margin: 0,
                maxHeight: "240px",
                overflow: "auto",
              }}
            >
              {output}
            </pre>
          </Field>
        </PanelSectionRow>
      ) : null}
    </PanelSection>
  );
}
