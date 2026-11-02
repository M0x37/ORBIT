const test = require("node:test");
const assert = require("node:assert/strict");
const { getNetworkOverview } = require("../../lib/network-service.cjs");

const interfaces = {
  Ethernet: [
    { address: "192.168.1.24", family: "IPv4", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
    { address: "fe80::1234", family: "IPv6", internal: false, mac: "aa:bb:cc:dd:ee:ff" },
    { address: "::1", family: "IPv6", internal: true }
  ],
  Loopback: [
    { address: "127.0.0.1", family: "IPv4", internal: true }
  ]
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("getNetworkOverview reports internet status, latency, and the active local IP", async () => {
  const result = await getNetworkOverview({
    networkInterfaces: interfaces,
    dnsServers: ["192.168.1.1", "1.1.1.1"],
    fetchImpl: async () => jsonResponse(200, { ip: "203.0.113.42" }),
    probe: async () => ({
      connected: true,
      latencyMs: 18,
      localAddress: "192.168.1.24"
    })
  });

  assert.equal(result.connected, true);
  assert.equal(result.latencyMs, 18);
  assert.equal(result.localIp, "192.168.1.24");
  assert.equal(result.localIpv6, "fe80::1234");
  assert.equal(result.interfaceName, "Ethernet");
  assert.equal(result.macAddress, "aa:bb:cc:dd:ee:ff");
  assert.deepEqual(result.dnsServers, ["192.168.1.1", "1.1.1.1"]);
  assert.equal(result.publicIp, "203.0.113.42");
  assert.equal(result.publicIpError, null);
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

test("getNetworkOverview uses a local interface address when the internet is unavailable", async () => {
  const result = await getNetworkOverview({
    networkInterfaces: interfaces,
    dnsServers: ["192.168.1.1"],
    fetchImpl: async () => jsonResponse(200, { ip: "2001:db8::8" }),
    probe: async () => ({
      connected: false,
      latencyMs: null,
      localAddress: null
    })
  });

  assert.equal(result.connected, false);
  assert.equal(result.latencyMs, null);
  assert.equal(result.localIp, "192.168.1.24");
  assert.equal(result.interfaceName, "Ethernet");
  assert.equal(result.macAddress, "aa:bb:cc:dd:ee:ff");
  assert.deepEqual(result.dnsServers, ["192.168.1.1"]);
  assert.equal(result.publicIp, "2001:db8::8");
  assert.equal(result.publicIpError, null);
});

test("getNetworkOverview reports public IP lookup failures without losing local details", async () => {
  const result = await getNetworkOverview({
    networkInterfaces: interfaces,
    fetchImpl: async () => { throw new Error("offline"); },
    probe: async () => ({
      connected: true,
      latencyMs: 18,
      localAddress: "192.168.1.24"
    })
  });

  assert.equal(result.connected, true);
  assert.equal(result.localIp, "192.168.1.24");
  assert.equal(result.publicIp, null);
  assert.equal(result.publicIpError, "Public IP lookup service is unavailable.");
});

test("getNetworkOverview rejects malformed public IP values", async () => {
  const result = await getNetworkOverview({
    networkInterfaces: interfaces,
    fetchImpl: async () => jsonResponse(200, { ip: "not-an-ip" }),
    probe: async () => ({
      connected: true,
      latencyMs: 18,
      localAddress: "192.168.1.24"
    })
  });

  assert.equal(result.publicIp, null);
  assert.equal(result.publicIpError, "Public IP lookup returned an invalid address.");
});
