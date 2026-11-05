const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AUDIO_DEVICE_SCRIPT, createAudioService } = require("../../lib/audio-service.cjs");

const devices = [
  { id: "headset", name: "Arctis Nova Pro" },
  { id: "monitor", name: "DELL U2723QE" }
];

function createFakeRunner(responses) {
  const calls = [];
  return {
    calls,
    run: async (action, payload) => {
      calls.push({ action, payload });
      const response = responses[action];
      return typeof response === "function" ? response(payload) : response;
    }
  };
}

async function createService(responses, existingConfig) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-audio-"));
  const configPath = path.join(dir, "output-devices.json");
  if (existingConfig !== undefined) {
    await fs.writeFile(configPath, JSON.stringify(existingConfig));
  }
  const runner = createFakeRunner(responses);
  const service = createAudioService({
    runPowerShell: runner.run,
    getConfigPath: () => configPath,
    fsImpl: fs
  });
  return { service, runner, dir, configPath };
}

const savedPair = {
  headset: { id: "headset", name: "Arctis Nova Pro" },
  monitor: { id: "monitor", name: "DELL U2723QE" }
};

const state = {
  output: { id: "headset", name: "Arctis Nova Pro", muted: false, volume: 68 },
  microphone: { id: "mic", name: "Arctis Mic", muted: true }
};

const monitorState = {
  output: { id: "monitor", name: "DELL U2723QE", muted: false, volume: 42 },
  microphone: { id: "mic", name: "Arctis Mic", muted: true }
};

function stateJson(value = state) {
  return JSON.stringify(value);
}

test("listOutputDevices parses valid devices and filters incomplete entries", async () => {
  const { service } = await createService({
    list: JSON.stringify([
      ...devices,
      { id: "missing-name" },
      { name: "missing-id" },
      { id: 7, name: "wrong-id-type" }
    ])
  });

  assert.deepEqual(await service.listOutputDevices(), devices);
});

test("listOutputDevices rejects malformed device JSON with a friendly error", async () => {
  const { service } = await createService({ list: "not json" });

  await assert.rejects(
    () => service.listOutputDevices(),
    { message: "The audio device list could not be read." }
  );
});

test("saveOutputPair writes the resolved devices and returns the pair", async () => {
  const { service, dir } = await createService({ list: JSON.stringify(devices) });

  const pair = await service.saveOutputPair({ headsetId: "headset", monitorId: "monitor" });

  assert.deepEqual(pair, savedPair);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(dir, "output-devices.json"), "utf8")),
    savedPair
  );
});

test("saveOutputPair rejects the same device twice", async () => {
  const { service } = await createService({ list: JSON.stringify(devices) });

  await assert.rejects(
    () => service.saveOutputPair({ headsetId: "headset", monitorId: "headset" }),
    { message: "Select two different output devices." }
  );
});

test("saveOutputPair rejects a device that is not available", async () => {
  const { service } = await createService({ list: JSON.stringify(devices) });

  await assert.rejects(
    () => service.saveOutputPair({ headsetId: "headset", monitorId: "gone" }),
    { message: "The selected output device is no longer available." }
  );
});

test("getOutputPair returns null when no pair has been saved", async () => {
  const { service } = await createService({ list: JSON.stringify(devices) });

  assert.equal(await service.getOutputPair(), null);
});

test("getOutputPair rejects an invalid saved selection", async () => {
  const { service } = await createService(
    { list: JSON.stringify(devices) },
    { headset: { id: "headset" } }
  );

  await assert.rejects(
    () => service.getOutputPair(),
    { message: "The saved output device selection could not be read." }
  );
});

test("getState parses output and microphone state", async () => {
  const { service, runner } = await createService({ state: stateJson() });

  assert.deepEqual(await service.getState(), state);
  assert.deepEqual(runner.calls, [{ action: "state", payload: undefined }]);
});

test("getState accepts missing output and microphone endpoints", async () => {
  const { service } = await createService({
    state: stateJson({ output: null, microphone: null })
  });

  assert.deepEqual(await service.getState(), { output: null, microphone: null });
});

test("getState maps runner and malformed payload failures to a friendly error", async () => {
  const failing = await createService({
    state: () => {
      throw new Error("raw powershell stderr");
    }
  });
  const malformed = await createService({ state: "not json" });

  await assert.rejects(
    () => failing.service.getState(),
    { message: "The audio state could not be read." }
  );
  await assert.rejects(
    () => malformed.service.getState(),
    { message: "The audio state could not be read." }
  );
});

test("setOutputMuted sends the boolean and returns the fresh state", async () => {
  const { service, runner } = await createService({ "set-output-mute": stateJson() });

  assert.deepEqual(await service.setOutputMuted(true), state);
  assert.deepEqual(runner.calls.at(-1), {
    action: "set-output-mute",
    payload: { muted: true }
  });
});

test("setOutputMuted rejects non-boolean input", async () => {
  const { service } = await createService({ "set-output-mute": stateJson() });

  await assert.rejects(
    () => service.setOutputMuted("yes"),
    { message: "The output mute state must be true or false." }
  );
});

test("setOutputMuted maps runner failures to a friendly error", async () => {
  const { service } = await createService({
    "set-output-mute": () => {
      throw new Error("raw powershell stderr");
    }
  });

  await assert.rejects(
    () => service.setOutputMuted(false),
    { message: "The output device could not be muted." }
  );
});

test("setMicrophoneMuted sends the boolean and returns the fresh state", async () => {
  const { service, runner } = await createService({ "set-mic-mute": stateJson() });

  assert.deepEqual(await service.setMicrophoneMuted(false), state);
  assert.deepEqual(runner.calls.at(-1), {
    action: "set-mic-mute",
    payload: { muted: false }
  });
});

test("setMicrophoneMuted rejects non-boolean input and runner failures", async () => {
  const invalid = await createService({ "set-mic-mute": stateJson() });
  const failing = await createService({
    "set-mic-mute": () => {
      throw new Error("raw powershell stderr");
    }
  });

  await assert.rejects(
    () => invalid.service.setMicrophoneMuted(null),
    { message: "The microphone mute state must be true or false." }
  );
  await assert.rejects(
    () => failing.service.setMicrophoneMuted(true),
    { message: "The microphone could not be muted." }
  );
});

test("setOutputVolume sends a rounded integer and returns the fresh state", async () => {
  const { service, runner } = await createService({ "set-volume": stateJson() });

  assert.deepEqual(await service.setOutputVolume(68), state);
  assert.deepEqual(runner.calls.at(-1), {
    action: "set-volume",
    payload: { volume: 68 }
  });
});

test("setOutputVolume clamps values outside 0-100", async () => {
  for (const [input, expected] of [[-5, 0], [150, 100], [42.6, 43]]) {
    const { service, runner } = await createService({ "set-volume": stateJson() });

    await service.setOutputVolume(input);

    assert.deepEqual(runner.calls.at(-1), {
      action: "set-volume",
      payload: { volume: expected }
    });
  }
});

test("setOutputVolume rejects non-finite and non-number input", async () => {
  const { service } = await createService({ "set-volume": stateJson() });

  for (const input of [NaN, Infinity, "68", null]) {
    await assert.rejects(
      () => service.setOutputVolume(input),
      { message: "The volume must be a number between 0 and 100." }
    );
  }
});

test("setOutputVolume maps runner failures to a friendly error", async () => {
  const { service } = await createService({
    "set-volume": () => {
      throw new Error("raw powershell stderr");
    }
  });

  await assert.rejects(
    () => service.setOutputVolume(50),
    { message: "The volume could not be changed." }
  );
});

test("toggleOutput switches from the headset to the monitor and returns state", async () => {
  const { service, runner } = await createService(
    {
      list: JSON.stringify(devices),
      default: "headset",
      set: stateJson(monitorState)
    },
    savedPair
  );

  const result = await service.toggleOutput();

  assert.deepEqual(result, {
    ok: true,
    message: "Output switched to DELL U2723QE.",
    state: monitorState
  });
  assert.deepEqual(runner.calls.slice(-2), [
    { action: "default", payload: undefined },
    { action: "set", payload: { deviceId: "monitor" } }
  ]);
  assert.equal(runner.calls.some((call) => call.action === "state"), false);
});

test("toggleOutput switches from the monitor to the headset", async () => {
  const { service, runner } = await createService(
    {
      list: JSON.stringify(devices),
      default: "monitor",
      set: stateJson()
    },
    savedPair
  );

  const result = await service.toggleOutput();

  assert.deepEqual(result, {
    ok: true,
    message: "Output switched to Arctis Nova Pro.",
    state
  });
  assert.deepEqual(runner.calls.at(-1), { action: "set", payload: { deviceId: "headset" } });
});

test("toggleOutput requires a saved pair", async () => {
  const { service } = await createService({ list: JSON.stringify(devices) });

  await assert.rejects(
    () => service.toggleOutput(),
    { message: "Select your headset and monitor in Quick Actions first." }
  );
});

test("toggleOutput rejects when a saved device is unavailable", async () => {
  const { service } = await createService(
    {
      list: JSON.stringify([devices[0]]),
      default: "headset",
      set: stateJson()
    },
    savedPair
  );

  await assert.rejects(
    () => service.toggleOutput(),
    { message: "A selected output device is unavailable. Re-select your devices in Quick Actions." }
  );
});

test("GetState does not hide endpoint COM failures as missing devices", () => {
  const start = AUDIO_DEVICE_SCRIPT.indexOf("public static object GetState()");
  const end = AUDIO_DEVICE_SCRIPT.indexOf("public static void SetOutputMute");
  assert.ok(start >= 0 && end > start, "GetState must exist before SetOutputMute");

  const body = AUDIO_DEVICE_SCRIPT.slice(start, end);
  assert.match(body, /ReadOutput\(\)/);
  assert.match(body, /ReadMicrophone\(\)/);
  assert.doesNotMatch(body, /catch/, "endpoint failures must propagate to the friendly state error");
});

test("toggleOutput targets the headset when a third device is current", async () => {
  const { service, runner } = await createService(
    {
      list: JSON.stringify(devices),
      default: "speakers",
      set: stateJson()
    },
    savedPair
  );

  const result = await service.toggleOutput();

  assert.deepEqual(result, {
    ok: true,
    message: "Output switched to Arctis Nova Pro.",
    state
  });
  assert.deepEqual(runner.calls.at(-1), { action: "set", payload: { deviceId: "headset" } });
});

test("toggleOutput maps a default action failure to the switch error", async () => {
  const { service } = await createService(
    {
      list: JSON.stringify(devices),
      default: () => {
        throw new Error("raw powershell stderr");
      },
      set: stateJson()
    },
    savedPair
  );

  await assert.rejects(
    () => service.toggleOutput(),
    { message: "The output device could not be switched." }
  );
});

test("toggleOutput maps a set action failure to the switch error", async () => {
  const { service } = await createService(
    {
      list: JSON.stringify(devices),
      default: "headset",
      set: () => {
        throw new Error("raw powershell stderr");
      }
    },
    savedPair
  );

  await assert.rejects(
    () => service.toggleOutput(),
    { message: "The output device could not be switched." }
  );
});

test("toggleOutput rejects when the set action returns malformed state", async () => {
  const { service } = await createService(
    {
      list: JSON.stringify(devices),
      default: "headset",
      set: "ok"
    },
    savedPair
  );

  await assert.rejects(
    () => service.toggleOutput(),
    { message: "The audio state could not be read." }
  );
});
