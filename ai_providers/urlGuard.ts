import dns from "dns";
import net from "net";
import { promisify } from "util";

const lookup = promisify(dns.lookup);

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => Number.isNaN(n))) return true; // fail closed
  const [a, b] = p;
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 127) return true;                      // loopback
  if (a === 0) return true;                         // 0.0.0.0/8
  if (a === 169 && b === 254) return true;          // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;// carrier-grade NAT
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true;          // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped (::ffff:a.b.c.d)
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown -> fail closed
}

/**
 * Validates a user-supplied provider base URL to mitigate SSRF + credential
 * leakage. Requires http/https and, unless `allowPrivate` is set (local
 * providers such as Ollama), rejects hosts that resolve to private, loopback,
 * link-local, or cloud-metadata addresses.
 *
 * Note: this does not fully prevent DNS-rebinding (TOCTOU between this check and
 * the actual request); it blocks the common static-private-target SSRF cases.
 */
export async function assertSafeProviderUrl(rawUrl: string, allowPrivate = false): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid provider URL: ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Provider URL must use http or https (got ${parsed.protocol})`);
  }
  if (allowPrivate) return;

  // WHATWG URL wraps IPv6 literals in brackets ("[::1]") — strip them so net.isIP works.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // Block bare-literal private addresses immediately.
  if (net.isIP(host) && isPrivateAddress(host)) {
    throw new Error("Provider URL resolves to a disallowed (private) address");
  }
  // Resolve hostnames and reject if any resolved address is private.
  if (!net.isIP(host)) {
    let results: { address: string }[];
    try {
      results = await lookup(host, { all: true });
    } catch {
      throw new Error(`Could not resolve provider host: ${host}`);
    }
    if (results.some(r => isPrivateAddress(r.address))) {
      throw new Error("Provider URL resolves to a disallowed (private) address");
    }
  }
}
