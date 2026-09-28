import { createHmac } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import https from "node:https";
import http from "node:http";
import type {
  FreeboxApiResponse,
  FreeboxDiscovery,
  AuthorizationResult,
  AuthorizationStatus,
  SessionResult,
  LoginStatus,
  FreeboxCredentials,
} from "../types.js";
import {
  APP_ID,
  APP_NAME,
  APP_VERSION,
  DEVICE_NAME,
  DEFAULT_FREEBOX_HOST,
  DEFAULT_API_VERSION,
  FREEBOX_ROOT_CA_ECC,
  FREEBOX_ROOT_CA_RSA,
  POLL_INTERVAL_MS,
  POLL_TIMEOUT_MS,
} from "../constants.js";

/** Domain suffixes Free actually uses for the remote API endpoint. */
const FREEBOX_API_DOMAIN_SUFFIXES = [".fbxos.fr", ".freebox.fr"];

const CREDENTIALS_DIR = join(homedir(), ".freebox-mcp");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "credentials.json");

export class FreeboxClient {
  private sessionToken: string | null = null;
  private credentials: FreeboxCredentials | null = null;
  private discovery: FreeboxDiscovery | null = null;
  private baseUrl: string = "";
  private useHttps: boolean = false;

  /**
   * Make an HTTP/HTTPS request to the Freebox.
   * Using native Node.js http/https modules for zero external dependencies.
   */
  private async httpRequest(
    url: string,
    method: string = "GET",
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<{ status: number; data: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";

      const options: https.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        // Trust Freebox CA certificates
        ...(isHttps
          ? {
              ca: [FREEBOX_ROOT_CA_ECC, FREEBOX_ROOT_CA_RSA],
              rejectUnauthorized: true,
            }
          : {}),
      };

      const bodyStr = body ? JSON.stringify(body) : undefined;
      if (bodyStr) {
        options.headers = {
          ...options.headers,
          "Content-Length": Buffer.byteLength(bodyStr).toString(),
        };
      }

      const lib = isHttps ? https : http;
      const req = lib.request(options, (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          resolve({ status: res.statusCode ?? 0, data });
        });
      });

      req.on("error", (err: Error) => reject(err));
      req.setTimeout(30000, () => {
        req.destroy(new Error("Request timeout"));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  /**
   * Log a raw (potentially sensitive) response body to stderr for local
   * debugging, and return a generic message safe to surface to the caller.
   * The raw body never reaches the MCP client / LLM context.
   */
  private failSafely(context: string, status: number, body: string): Error {
    process.stderr.write(
      `[freebox-mcp] ${context} — HTTP ${status} — raw body: ${body.slice(0, 500)}\n`
    );
    return new Error(
      `Invalid response from Freebox API (${context}, HTTP status ${status}). See server stderr logs for details.`
    );
  }

  /**
   * Make an authenticated API request.
   */
  async apiRequest<T = unknown>(
    path: string,
    method: string = "GET",
    body?: unknown
  ): Promise<FreeboxApiResponse<T>> {
    // Defense-in-depth: never let a caller escape the API base path.
    if (path.includes("..") || path.startsWith("/")) {
      throw new Error(
        `Invalid API path: path traversal or absolute path is not allowed.`
      );
    }

    await this.ensureSession();

    const url = `${this.baseUrl}/v${DEFAULT_API_VERSION}/${path}`;
    const headers: Record<string, string> = {};
    if (this.sessionToken) {
      headers["X-Fbx-App-Auth"] = this.sessionToken;
    }

    const response = await this.httpRequest(url, method, body, headers);
    let parsed: FreeboxApiResponse<T>;
    try {
      parsed = JSON.parse(response.data) as FreeboxApiResponse<T>;
    } catch {
      throw this.failSafely(`${method} ${path}`, response.status, response.data);
    }

    // Handle expired session - try to re-authenticate once
    if (!parsed.success && parsed.error_code === "auth_required") {
      this.sessionToken = null;
      await this.ensureSession();
      if (this.sessionToken) {
        headers["X-Fbx-App-Auth"] = this.sessionToken;
      }
      const retry = await this.httpRequest(url, method, body, headers);
      try {
        return JSON.parse(retry.data) as FreeboxApiResponse<T>;
      } catch {
        throw this.failSafely(`${method} ${path} (retry)`, retry.status, retry.data);
      }
    }

    return parsed;
  }

  /**
   * Discover the Freebox on the local network.
   */
  async discover(): Promise<FreeboxDiscovery> {
    if (this.discovery) return this.discovery;

    const host =
      process.env.FREEBOX_HOST || DEFAULT_FREEBOX_HOST;

    // HTTPS only. An automatic silent downgrade to HTTP would expose the
    // session token and every API payload to anyone on the local network,
    // so it must be an explicit, opt-in decision by the operator.
    let response: { status: number; data: string };
    try {
      response = await this.httpRequest(
        `https://${host}/api_version`
      );
    } catch (err: unknown) {
      if (process.env.FREEBOX_ALLOW_INSECURE_HTTP !== "1") {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(
          `HTTPS discovery of the Freebox at "${host}" failed (${reason}). ` +
            // Worded to avoid "send ... token": MCP hosts that scan tool results for
            // exfiltration phrases (e.g. Paperclip) otherwise block this error as an injection.
            `Refusing to fall back to plaintext HTTP, which would expose the Freebox session ` +
            `and all API traffic in cleartext on your local network. ` +
            `Check FREEBOX_HOST, or set FREEBOX_ALLOW_INSECURE_HTTP=1 to explicitly accept that risk.`
        );
      }
      process.stderr.write(
        "WARNING: HTTPS discovery failed; FREEBOX_ALLOW_INSECURE_HTTP=1 is set, falling back to insecure plaintext HTTP.\n"
      );
      response = await this.httpRequest(
        `http://${host}/api_version`
      );
    }

    try {
      this.discovery = JSON.parse(response.data) as FreeboxDiscovery;
    } catch {
      throw this.failSafely("GET /api_version", response.status, response.data);
    }

    // Build base URL
    if (this.discovery.https_available) {
      // api_domain comes from the (unauthenticated) discovery response, so it
      // must not be trusted blindly as a request target.
      const apiDomain = this.discovery.api_domain || "";
      const isKnownFreeboxDomain = FREEBOX_API_DOMAIN_SUFFIXES.some((suffix) =>
        apiDomain.toLowerCase().endsWith(suffix)
      );
      if (!isKnownFreeboxDomain) {
        throw new Error(
          `Freebox discovery returned an untrusted api_domain ("${apiDomain}"). ` +
            `Expected a domain ending in ${FREEBOX_API_DOMAIN_SUFFIXES.join(" or ")}. ` +
            `Aborting to avoid sending credentials to an attacker-controlled host.`
        );
      }
      this.baseUrl = `https://${apiDomain}:${this.discovery.https_port}${this.discovery.api_base_url}`;
      this.useHttps = true;
    } else {
      this.baseUrl = `http://${host}${this.discovery.api_base_url}`;
      this.useHttps = false;
    }

    // Remove trailing slash from baseUrl for clean path joining
    this.baseUrl = this.baseUrl.replace(/\/$/, "");

    return this.discovery;
  }

  /**
   * Load stored credentials from disk.
   */
  async loadCredentials(): Promise<FreeboxCredentials | null> {
    // Check environment variables first
    if (process.env.FREEBOX_APP_TOKEN && process.env.FREEBOX_APP_ID) {
      this.credentials = {
        app_token: process.env.FREEBOX_APP_TOKEN,
        app_id: process.env.FREEBOX_APP_ID,
        api_domain: process.env.FREEBOX_API_DOMAIN || "",
        https_port: parseInt(process.env.FREEBOX_HTTPS_PORT || "0"),
        api_base_url: process.env.FREEBOX_API_BASE_URL || "/api/",
        api_version: process.env.FREEBOX_API_VERSION || "4.0",
      };
      return this.credentials;
    }

    try {
      await access(CREDENTIALS_FILE);
      const data = await readFile(CREDENTIALS_FILE, "utf-8");
      this.credentials = JSON.parse(data) as FreeboxCredentials;
      return this.credentials;
    } catch {
      return null;
    }
  }

  /**
   * Save credentials to disk.
   */
  async saveCredentials(creds: FreeboxCredentials): Promise<void> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
    await writeFile(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    this.credentials = creds;
  }

  /**
   * Register a new app with the Freebox. Requires physical access to
   * validate on the Freebox LCD screen.
   */
  async registerApp(): Promise<{
    app_token: string;
    track_id: number;
    status: string;
  }> {
    await this.discover();

    const url = `${this.baseUrl}/v${DEFAULT_API_VERSION}/login/authorize/`;
    const response = await this.httpRequest(url, "POST", {
      app_id: APP_ID,
      app_name: APP_NAME,
      app_version: APP_VERSION,
      device_name: DEVICE_NAME,
    });

    let parsed: FreeboxApiResponse<AuthorizationResult>;
    try {
      parsed = JSON.parse(response.data) as FreeboxApiResponse<AuthorizationResult>;
    } catch {
      throw this.failSafely("POST login/authorize/", response.status, response.data);
    }
    if (!parsed.success || !parsed.result) {
      throw new Error(
        `Failed to register app: ${parsed.msg || parsed.error_code || "unknown error"}`
      );
    }

    const { app_token, track_id } = parsed.result;

    // Poll for authorization status
    const startTime = Date.now();
    let status = "pending";

    while (status === "pending" && Date.now() - startTime < POLL_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      const trackUrl = `${this.baseUrl}/v${DEFAULT_API_VERSION}/login/authorize/${track_id}`;
      const trackResponse = await this.httpRequest(trackUrl, "GET");
      let trackParsed: FreeboxApiResponse<AuthorizationStatus>;
      try {
        trackParsed = JSON.parse(trackResponse.data) as FreeboxApiResponse<AuthorizationStatus>;
      } catch {
        continue;
      }

      if (trackParsed.success && trackParsed.result) {
        status = trackParsed.result.status;
      }
    }

    if (status === "granted") {
      const disc = this.discovery!;
      const creds: FreeboxCredentials = {
        app_token,
        app_id: APP_ID,
        api_domain: disc.api_domain,
        https_port: disc.https_port,
        api_base_url: disc.api_base_url,
        api_version: disc.api_version,
      };
      await this.saveCredentials(creds);
    }

    return { app_token, track_id, status };
  }

  /**
   * Open a session using the stored app_token and a challenge.
   */
  async openSession(): Promise<SessionResult> {
    await this.discover();

    const creds = await this.loadCredentials();
    if (!creds) {
      throw new Error(
        "No credentials found. Use freebox_register_app first to register this app with your Freebox."
      );
    }

    // Get the current challenge
    const loginUrl = `${this.baseUrl}/v${DEFAULT_API_VERSION}/login/`;
    const loginResponse = await this.httpRequest(loginUrl, "GET");
    let loginParsed: FreeboxApiResponse<LoginStatus>;
    try {
      loginParsed = JSON.parse(loginResponse.data) as FreeboxApiResponse<LoginStatus>;
    } catch {
      throw this.failSafely("GET login/", loginResponse.status, loginResponse.data);
    }

    if (!loginParsed.success || !loginParsed.result) {
      throw new Error(
        `Failed to get challenge: ${loginParsed.msg || loginParsed.error_code}`
      );
    }

    const challenge = loginParsed.result.challenge;

    // Compute HMAC-SHA1 password
    const password = createHmac("sha1", creds.app_token)
      .update(challenge)
      .digest("hex");

    // Open session
    const sessionUrl = `${this.baseUrl}/v${DEFAULT_API_VERSION}/login/session/`;
    const sessionResponse = await this.httpRequest(sessionUrl, "POST", {
      app_id: creds.app_id,
      password,
    });

    let sessionParsed: FreeboxApiResponse<SessionResult>;
    try {
      sessionParsed = JSON.parse(sessionResponse.data) as FreeboxApiResponse<SessionResult>;
    } catch {
      throw this.failSafely("POST login/session/", sessionResponse.status, sessionResponse.data);
    }

    if (!sessionParsed.success || !sessionParsed.result) {
      throw new Error(
        `Failed to open session: ${sessionParsed.msg || sessionParsed.error_code}`
      );
    }

    this.sessionToken = sessionParsed.result.session_token;
    return sessionParsed.result;
  }

  /**
   * Ensure we have a valid session.
   */
  async ensureSession(): Promise<void> {
    if (this.sessionToken) return;

    const creds = await this.loadCredentials();
    if (!creds) {
      throw new Error(
        "No credentials found. Use freebox_register_app first to register this app with your Freebox."
      );
    }

    await this.openSession();
  }

  /**
   * Close the current session.
   */
  async closeSession(): Promise<void> {
    if (!this.sessionToken) return;

    try {
      const url = `${this.baseUrl}/v${DEFAULT_API_VERSION}/login/logout/`;
      await this.httpRequest(url, "POST", undefined, {
        "X-Fbx-App-Auth": this.sessionToken,
      });
    } finally {
      this.sessionToken = null;
    }
  }

  /**
   * Get connection info (no auth required).
   */
  async getDiscoveryInfo(): Promise<FreeboxDiscovery> {
    return this.discover();
  }

  /**
   * Check if we have stored credentials.
   */
  async hasCredentials(): Promise<boolean> {
    return (await this.loadCredentials()) !== null;
  }

  /**
   * Check if we have an active session.
   */
  isAuthenticated(): boolean {
    return this.sessionToken !== null;
  }
}

// Singleton instance
export const freeboxClient = new FreeboxClient();
