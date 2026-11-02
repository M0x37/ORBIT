const net = require("node:net");
const os = require("node:os");
const dns = require("node:dns");

const DEFAULT_PUBLIC_IP_URL = "https://api.ipify.org?format=json";

function findLocalInterface(networkInterfaces, address) {
  if (address) {
    const activeInterface = Object.entries(networkInterfaces).find(([, addresses]) =>
      addresses?.some((item) => item.address === address)
    );
    if (activeInterface) {
      const ipv4 = activeInterface[1].find((item) =>
        (item.family === "IPv4" || item.family === 4) && !item.internal
      );
      const ipv6 = activeInterface[1].find((item) =>
        (item.family === "IPv6" || item.family === 6) && !item.internal
      );
      return {
        interfaceName: activeInterface[0],
        macAddress: activeInterface[1][0]?.mac || null,
        ipv4: ipv4?.address || null,
        ipv6: ipv6?.address || null
      };
    }
  }

  for (const [name, addresses] of Object.entries(networkInterfaces)) {
    const ipv4 = addresses?.find((item) =>
      (item.family === "IPv4" || item.family === 4) && !item.internal
    );
    if (ipv4) {
      const ipv6 = addresses.find((item) =>
        (item.family === "IPv6" || item.family === 6) && !item.internal
      );
      return {
        interfaceName: name,
        macAddress: addresses[0]?.mac || null,
        ipv4: ipv4.address,
        ipv6: ipv6?.address || null
      };
    }
  }
  return { interfaceName: null, macAddress: null, ipv4: null, ipv6: null };
}

function probeConnection({ host, port, timeoutMs }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const socket = net.createConnection({ host, port });
    let completed = false;
    const finish = (result) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      finish({
        connected: true,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        localAddress: socket.localAddress
      });
    });
    socket.once("timeout", () => finish({ connected: false, latencyMs: null, localAddress: socket.localAddress || null }));
    socket.once("error", () => finish({ connected: false, latencyMs: null, localAddress: socket.localAddress || null }));
  });
}

async function getNetworkOverview({
  networkInterfaces = os.networkInterfaces(),
  dnsServers = dns.getServers(),
  probe = probeConnection,
  fetchImpl = fetch,
  publicIpUrl = DEFAULT_PUBLIC_IP_URL,
  host = "1.1.1.1",
  port = 443,
  timeoutMs = 3000
} = {}) {
  const [result, publicIpResult] = await Promise.all([
    probe({ host, port, timeoutMs }),
    lookupPublicIp({ fetchImpl, url: publicIpUrl, timeoutMs })
  ]);
  const activeInterface = findLocalInterface(networkInterfaces, result.localAddress);

  return {
    connected: result.connected,
    latencyMs: result.latencyMs,
    localIp: result.localAddress || activeInterface.ipv4,
    localIpv6: activeInterface.ipv6,
    interfaceName: activeInterface.interfaceName,
    macAddress: activeInterface.macAddress,
    dnsServers: dnsServers.filter((server) => typeof server === "string"),
    publicIp: publicIpResult.address,
    publicIpError: publicIpResult.error,
    checkedAt: new Date().toISOString()
  };
}

async function lookupPublicIp({ fetchImpl, url, timeoutMs }) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return { address: null, error: "Public IP lookup service is unavailable." };
  }

  if (!response.ok) {
    return { address: null, error: `Public IP lookup returned HTTP ${response.status}.` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return { address: null, error: "Public IP lookup returned an invalid response." };
  }

  const address = typeof payload?.ip === "string" ? payload.ip.trim() : "";
  if (!address || net.isIP(address) === 0) {
    return { address: null, error: "Public IP lookup returned an invalid address." };
  }
  return { address, error: null };
}

module.exports = { getNetworkOverview, DEFAULT_PUBLIC_IP_URL };
