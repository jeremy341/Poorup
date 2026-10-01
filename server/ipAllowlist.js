import net from 'node:net';

// Table of non-public IPv4 ranges. Each rule constrains only the octets it
// lists, so a rule matches exactly the blocks the raw comparisons matched.
const IPV4_NON_PUBLIC_RULES = [
  { a: [0, 0] },
  { a: [10, 10] },
  { a: [127, 127] },
  { a: [224, Number.POSITIVE_INFINITY] },
  { a: [100, 100], b: [64, 127] },
  { a: [169, 169], b: [254, 254] },
  { a: [172, 172], b: [16, 31] },
  { a: [192, 192], b: [0, 0], c: [0, 0] },
  { a: [192, 192], b: [0, 0], c: [2, 2] },
  { a: [192, 192], b: [88, 88], c: [99, 99] },
  { a: [192, 192], b: [168, 168] },
  { a: [198, 198], b: [18, 19] },
  { a: [198, 198], b: [51, 51], c: [100, 100] },
  { a: [203, 203], b: [0, 0], c: [113, 113] },
];

const IPV6_NON_PUBLIC_PREFIXES = [
  { mask: 0xfe00, value: 0xfc00 }, // unique-local fc00::/7
  { mask: 0xffc0, value: 0xfe80 }, // link-local fe80::/10
  { mask: 0xffc0, value: 0xfec0 }, // deprecated site-local fec0::/10
  { mask: 0xff00, value: 0xff00 }, // multicast ff00::/8
];

const IPV6_SPECIAL_PREFIXES = [0x2002, 0x3fff]; // 6to4 and documentation ranges

const IPV6_NON_PUBLIC_HOSTS = ['::', '::1'];

function octetInRule(range, value) {
  if (!range) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return value >= range[0] && value <= range[1];
}

function isNonPublicIpv4(host) {
  const [a, b, c] = host.split('.').map(Number);
  return IPV4_NON_PUBLIC_RULES.some(rule => octetInRule(rule.a, a) && octetInRule(rule.b, b) && octetInRule(rule.c, c));
}

function expandIpv4Tail(address) {
  const separator = address.lastIndexOf(':');
  const ipv4 = address.slice(separator + 1);
  if (separator < 0 || net.isIP(ipv4) !== 4) return null;
  const [a, b, c, d] = ipv4.split('.').map(Number);
  return `${address.slice(0, separator)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
}

function ipv6FillIsValid(halfCount, missing) {
  if (halfCount === 1) return missing === 0;
  return missing >= 1;
}

function ipv6Words(host) {
  let address = host;
  if (address.includes('.')) {
    address = expandIpv4Tail(address);
    if (!address) return null;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':').map(word => Number.parseInt(word, 16)) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':').map(word => Number.parseInt(word, 16)) : [];
  const missing = 8 - left.length - right.length;
  if (!ipv6FillIsValid(halves.length, missing)) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function ipv4FromIpv6(words) {
  return [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff].join('.');
}

function isIpv4MappedAddress(words) {
  return words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
}

// Deprecated IPv4-compatible addresses are not valid public destinations.
function isIpv4CompatibleAddress(words) {
  return words.slice(0, 6).every(word => word === 0);
}

function matchesIpv6NonPublicPrefix(words) {
  return IPV6_NON_PUBLIC_PREFIXES.some(rule => (words[0] & rule.mask) === rule.value);
}

// Only global-unicast 2000::/3 remains publicly routable.
function isIpv6GlobalUnicast(words) {
  return (words[0] & 0xe000) === 0x2000;
}

function isIpv6Special2001(words) {
  if (words[0] !== 0x2001) return false;
  return words[1] <= 0x01ff || words[1] === 0x0db8;
}

function isNonPublicIpv6(host) {
  if (IPV6_NON_PUBLIC_HOSTS.includes(host)) return true;
  const words = ipv6Words(host);
  if (!words) return true;
  if (isIpv4MappedAddress(words)) return isNonPublicIpv4(ipv4FromIpv6(words));
  if (isIpv4CompatibleAddress(words)) return true;
  if (matchesIpv6NonPublicPrefix(words)) return true;
  if (!isIpv6GlobalUnicast(words)) return true;
  if (isIpv6Special2001(words)) return true;
  return IPV6_SPECIAL_PREFIXES.includes(words[0]);
}

export { ipv4FromIpv6, ipv6Words, isNonPublicIpv4, isNonPublicIpv6 };
