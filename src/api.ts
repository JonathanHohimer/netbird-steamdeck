import { callable } from "@decky/api";
import type {
  BinaryInfo,
  CommandResult,
  InstallResult,
  InstallStatus,
  NetworksListResult,
  PluginSettings,
  StatusResult,
} from "./types";

export const getBinaryInfo = callable<[], BinaryInfo>("get_binary_info");
export const getInstallStatus = callable<[], InstallStatus>("get_install_status");
export const installNetbird = callable<[version?: string], InstallResult>(
  "install_netbird"
);
export const updateNetbird = callable<[], InstallResult>("update_netbird");
export const uninstallNetbird = callable<[], InstallResult>("uninstall_netbird");
export const serviceStart = callable<[], CommandResult>("service_start");
export const serviceStop = callable<[], CommandResult>("service_stop");
export const serviceEnable = callable<[], CommandResult>("service_enable");
export const getSettings = callable<[], PluginSettings>("get_settings");
export const setManagementUrl = callable<[url: string], PluginSettings>(
  "set_management_url"
);
export const getStatus = callable<[detailed?: boolean], StatusResult>("status");
export const netbirdUp = callable<
  [setup_key?: string, management_url?: string, no_browser?: boolean],
  CommandResult
>("up");
export const netbirdDown = callable<[], CommandResult>("down");
export const netbirdLogin = callable<
  [setup_key?: string, management_url?: string, no_browser?: boolean],
  CommandResult
>("login");
export const netbirdLogout = callable<[], CommandResult>("logout");
export const networksList = callable<[], NetworksListResult>("networks_list");
export const networksSelect = callable<
  [network_ids?: string[], append?: boolean],
  CommandResult
>("networks_select");
export const networksDeselect = callable<
  [network_ids?: string[]],
  CommandResult
>("networks_deselect");
export const runCommand = callable<[args: string], CommandResult>("run_command");
