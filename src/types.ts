// Freebox API response wrapper
export interface FreeboxApiResponse<T = unknown> {
  success: boolean;
  result?: T;
  error_code?: string;
  msg?: string;
  uid?: string;
}

// Discovery
export interface FreeboxDiscovery {
  uid: string;
  device_name: string;
  api_version: string;
  api_base_url: string;
  device_type: string;
  api_domain: string;
  https_available: boolean;
  https_port: number;
}

// Auth
export interface TokenRequest {
  app_id: string;
  app_name: string;
  app_version: string;
  device_name: string;
}

export interface AuthorizationResult {
  app_token: string;
  track_id: number;
}

export interface AuthorizationStatus {
  status: "unknown" | "pending" | "timeout" | "granted" | "denied";
  challenge: string;
}

export interface SessionResult {
  session_token: string;
  challenge: string;
  permissions: Record<string, boolean>;
}

export interface LoginStatus {
  logged_in: boolean;
  challenge: string;
}

// System
export interface SystemInfo {
  mac: string;
  box_flavor: string;
  temp_cpub: number;
  disk_status: string;
  box_authenticated: boolean;
  board_name: string;
  fan_rpm: number;
  temp_sw: number;
  uptime: string;
  uptime_val: number;
  user_main_storage: string;
  temp_cpum: number;
  serial: string;
  firmware_version: string;
}

// Connection
export interface ConnectionStatus {
  type: string;
  rate_down: number;
  bytes_up: number;
  rate_up: number;
  bandwidth_up: number;
  ipv4: string;
  ipv6: string;
  bandwidth_down: number;
  state: string;
  bytes_down: number;
  media: string;
  ipv4_port_range?: [number, number];
}

export interface ConnectionConfig {
  ping: boolean;
  is_secure_pass: boolean;
  remote_access_port: number;
  remote_access: boolean;
  wol: boolean;
  adblock: boolean;
  adblock_not_set: boolean;
  api_remote_access: boolean;
  allow_token_request: boolean;
  remote_access_min_port: number;
  remote_access_max_port: number;
}

// LAN
export interface LanConfig {
  name_dns: string;
  name_mdns: string;
  name: string;
  mode: string;
  name_netbios: string;
  ip: string;
}

export interface LanHost {
  id: string;
  primary_name: string;
  host_type: string;
  primary_name_manual: boolean;
  l2ident: { id: string; type: string };
  vendor_name: string;
  persistent: boolean;
  reachable: boolean;
  last_time_reachable: number;
  active: boolean;
  last_activity: number;
  names: Array<{ name: string; source: string }>;
  l3connectivities: Array<{
    addr: string;
    af: string;
    active: boolean;
    reachable: boolean;
    last_activity: number;
    last_time_reachable: number;
  }>;
}

// WiFi
export interface WifiGlobalConfig {
  enabled: boolean;
  mac_filter_state: "disabled" | "whitelist" | "blacklist";
}

export interface WifiStation {
  id: string;
  mac: string;
  bssid: string;
  hostname: string;
  state: string;
  inactive: number;
  conn_duration: number;
  rx_bytes: number;
  tx_bytes: number;
  tx_rate: number;
  rx_rate: number;
  signal: number;
  host?: LanHost;
  flags?: {
    legacy: boolean;
    ht: boolean;
    vht: boolean;
    authorized: boolean;
  };
}

// DHCP
export interface DhcpConfig {
  enabled: boolean;
  sticky_assign: boolean;
  gateway: string;
  netmask: string;
  ip_range_start: string;
  ip_range_end: string;
  always_broadcast: boolean;
  dns: string[];
}

export interface DhcpStaticLease {
  id: string;
  mac: string;
  comment: string;
  hostname: string;
  ip: string;
  host?: LanHost;
}

export interface DhcpDynamicLease {
  mac: string;
  hostname: string;
  ip: string;
  lease_remaining: number;
  assign_time: number;
  refresh_time: number;
  is_static: boolean;
  host?: LanHost;
}

// Downloads
export interface DownloadTask {
  id: number;
  type: string;
  name: string;
  status: string;
  io_priority: string;
  size: number;
  queue_pos: number;
  tx_bytes: number;
  rx_bytes: number;
  tx_rate: number;
  rx_rate: number;
  tx_pct: number;
  rx_pct: number;
  error: string;
  created_ts: number;
  eta: number;
  download_dir: string;
}

// Filesystem
export interface FsTask {
  id: number;
  type: string;
  state: string;
  error: string;
  created_ts: number;
  started_ts: number;
  done_ts: number;
  duration: number;
  progress: number;
  eta: number;
  from: string;
  to: string;
  nfiles: number;
  nfiles_done: number;
  total_bytes: number;
  total_bytes_done: number;
  curr_bytes: number;
  curr_bytes_done: number;
  rate: number;
}

// Stored credentials
export interface FreeboxCredentials {
  app_token: string;
  app_id: string;
  api_domain: string;
  https_port: number;
  api_base_url: string;
  api_version: string;
}

// Port forwarding
export interface PortForwardingConfig {
  id: number;
  enabled: boolean;
  comment: string;
  lan_port: number;
  wan_port_start: number;
  wan_port_end: number;
  lan_ip: string;
  ip_proto: "tcp" | "udp";
  src_ip: string;
  hostname: string;
  host?: LanHost;
}

// Switch
export interface SwitchPortStatus {
  id: number;
  link: string;
  duplex: string;
  speed: string;
  mode: string;
  mac_list: Array<{ mac: string; hostname?: string }>;
}
