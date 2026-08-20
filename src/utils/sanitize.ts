/**
 * Sanitize a string that originates from the Freebox (device names, download
 * task names, filenames, DHCP hostnames...) before interpolating it into the
 * Markdown text returned to the MCP client.
 *
 * These values are attacker-controllable: anyone who can join the LAN or seed a
 * torrent can choose them, so they are a prompt-injection vector. Strip control
 * characters (including newlines, which would let a value forge new Markdown
 * lines or fake instructions) and clip the length.
 *
 * Only use this on display strings — never on values sent back to the API.
 */
export function sanitizeDisplay(value: unknown, maxLength = 100): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\r\n\x00-\x1f]/g, " ")
    .slice(0, maxLength);
}
