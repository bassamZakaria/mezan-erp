import { isIP } from "node:net";

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

/** Expands any legal IPv6 text form to its 16 bytes, or null when it is not one. */
function ipv6Bytes(text: string): number[] | null {
  if (isIP(text) !== 6) return null;
  let head = text;
  const lastColon = head.lastIndexOf(":");
  const maybeV4 = head.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    if (isIP(maybeV4) !== 4) return null;
    const quad = maybeV4.split(".").map(Number) as [number, number, number, number];
    head = `${head.slice(0, lastColon + 1)}${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`;
  }
  const [left, right] = head.includes("::") ? head.split("::") : [head, null];
  const leftGroups = left && left.length > 0 ? left.split(":") : [];
  const rightGroups = right && right.length > 0 ? right.split(":") : [];
  const fill = 8 - leftGroups.length - rightGroups.length;
  if ((right === null && fill !== 0) || fill < 0) return null;
  const bytes: number[] = [];
  for (const group of [...leftGroups, ...Array<string>(fill).fill("0"), ...rightGroups]) {
    const value = parseInt(group, 16);
    if (Number.isNaN(value) || value < 0 || value > 0xffff) return null;
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes.length === 16 ? bytes : null;
}

// SECURITY: IPv6 is parsed to bytes, never pattern-matched — `::ffff:127.0.0.1`, `::ffff:7f00:1`
// and `0:0:0:0:0:ffff:7f00:1` are one loopback, and every regex version missed a spelling.
export function isBlockedWebhookAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0] as string;
  const kind = isIP(bare);
  if (kind === 4) return isBlockedIpv4(bare);
  if (kind !== 6) return true;
  const bytes = ipv6Bytes(bare);
  if (!bytes) return true;
  const firstTenZero = bytes.slice(0, 10).every((b) => b === 0);
  if (firstTenZero && ((bytes[10] === 0xff && bytes[11] === 0xff) || (bytes[10] === 0 && bytes[11] === 0))) {
    return isBlockedIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  const first = bytes[0] as number;
  const second = bytes[1] as number;
  if (first === 0x00 && second === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) return true;
  if (first === 0x20 && second === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  if (first === 0x20 && second === 0x02) return true;
  if (first === 0xfe && (second & 0xc0) === 0x80) return true;
  if (first === 0xfe && (second & 0xc0) === 0xc0) return true;
  if ((first & 0xfe) === 0xfc) return true;
  if (first === 0xff) return true;
  return false;
}
