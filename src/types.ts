export type CommandResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
  auth_url?: string | null;
};

export type BinaryInfo = {
  found: boolean;
  path: string | null;
  version: string | null;
  managed?: boolean;
  service_active?: boolean;
  service_enabled?: boolean;
  unit_present?: boolean;
  daemon_socket?: boolean;
  daemon_reachable?: boolean;
  opt_path?: string;
  is_root?: boolean;
  uid?: number;
};

export type InstallStatus = BinaryInfo & {
  latest: string | null;
  latest_error: string | null;
  update_available: boolean;
  last_install_log?: string;
};

export type InstallResult = {
  success: boolean;
  version?: string | null;
  path?: string | null;
  message?: string;
  stderr?: string;
  install?: BinaryInfo;
};

export type PluginSettings = {
  management_url: string;
};

export type NetworkEntry = {
  id: string;
  selected: boolean;
  description?: string;
  raw?: string;
};

export type NetworksListResult = CommandResult & {
  networks: NetworkEntry[];
};

export type PeerState = {
  fqdn?: string;
  hostname?: string;
  netbirdIp?: string;
  netbirdIpv6?: string;
  ip?: string;
  status?: string;
  connectionStatus?: string;
  connectionType?: string;
  connType?: string;
  direct?: boolean;
  latency?: string | number;
  lastSeen?: string;
  lastStatusUpdate?: string;
};

export type PeersBlock = {
  total?: number;
  connected?: number;
  details?: PeerState[];
};

export type StatusParsed = {
  daemonStatus?: string;
  status?: string;
  cliVersion?: string;
  daemonVersion?: string;
  netbirdIp?: string;
  fqdn?: string;
  publicKey?: string;
  profileName?: string;
  management?: {
    connected?: boolean | string;
    url?: string;
  };
  signal?: {
    connected?: boolean | string;
    url?: string;
  };
  relays?: {
    total?: number;
    available?: number;
  };
  peers?: PeerState[] | PeersBlock;
  networks?: string[];
};

export type StatusResult = CommandResult & {
  parsed: StatusParsed | null;
  detail: string;
  daemon_status: string | null;
  connected: boolean;
};
