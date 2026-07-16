import { PanelSection, PanelSectionRow, Field } from "@decky/ui";
import type { StatusResult } from "../types";
import { asPeers, formatLatency, peerSummary } from "./statusHelpers";

type Props = {
  status: StatusResult | null;
};

export function PeersPanel({ status }: Props) {
  const peers = asPeers(status);
  const summary = peerSummary(status);

  return (
    <PanelSection title={`Peers (${summary})`}>
      {peers.length === 0 ? (
        <PanelSectionRow>
          <Field label="Peers" focusable={false}>
            No peers found (connect first)
          </Field>
        </PanelSectionRow>
      ) : (
        peers.map((peer, idx) => {
          const name = peer.fqdn || peer.hostname || `peer-${idx}`;
          const peerIp = peer.netbirdIp || peer.ip || "—";
          const st = peer.status || peer.connectionStatus || "—";
          const kind =
            peer.connectionType ||
            peer.connType ||
            (peer.direct ? "P2P" : "—");
          const latency = formatLatency(peer.latency);
          const lines = [
            peerIp,
            st,
            kind,
            latency || null,
          ].filter(Boolean);

          return (
            <PanelSectionRow key={`${name}-${peerIp}-${idx}`}>
              <Field label={name} focusable={false}>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                    fontSize: "12px",
                    lineHeight: "1.35",
                    wordBreak: "break-all",
                  }}
                >
                  {lines.map((line, lineIdx) => (
                    <div key={`${idx}-${lineIdx}`}>{line}</div>
                  ))}
                </div>
              </Field>
            </PanelSectionRow>
          );
        })
      )}
    </PanelSection>
  );
}
