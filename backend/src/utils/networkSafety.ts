import net from "net";

/**
 * IP address classification used before any server-side image fetch.
 *
 * Fails closed: an address that cannot be parsed is treated as unsafe.
 */
export function isPrivateOrReservedIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateOrReservedIpv4(address);
  if (family === 6) return isPrivateOrReservedIpv6(address);
  return true;
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    octets.push(value);
  }
  return octets;
}

function isPrivateOrReservedIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const [a, b, c] = octets;

  // 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local)
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;

  // 172.16/12, 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  // Documentation / benchmark / reserved ranges
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;

  // Multicast and reserved (224/4, 240/4, broadcast)
  if (a >= 224) return true;

  return false;
}

function isPrivateOrReservedIpv6(address: string): boolean {
  const value = address.toLowerCase().split("%")[0];

  if (value === "::" || value === "::1") return true;

  // IPv4-mapped IPv6 (::ffff:a.b.c.d) must be classified as the embedded IPv4.
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isPrivateOrReservedIpv4(mapped);
    return true;
  }

  // Only global unicast (2000::/3) is allowed, minus known special ranges.
  const firstHextet = Number.parseInt(value.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstHextet)) return true;
  if (firstHextet < 0x2000 || firstHextet > 0x3fff) return true;

  // 2001:db8::/32 (documentation), 2001:0::/32 (Teredo), 2002::/16 (6to4)
  if (value.startsWith("2001:db8")) return true;
  if (value.startsWith("2001:0:")) return true;
  if (value.startsWith("2002:")) return true;

  return false;
}

/**
 * Hostnames that must never be accepted as an artwork source, even when a
 * permissive allowlist is configured by mistake.
 */
export function isDisallowedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;

  const ipFamily = net.isIP(host);
  if (ipFamily !== 0) return isPrivateOrReservedIp(host);

  return false;
}