// Windows Core Audio service. Every action runs through one embedded PowerShell
// 5.1 script; the factory accepts an injectable runner so tests stay offline.

const defaultFs = require("node:fs/promises");

// PowerShell/C# bridge: device list, default-device switching, and endpoint
// mute/volume state for the default render and communications capture devices.
const AUDIO_DEVICE_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class AudioDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
  [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
  [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, out IntPtr result);
  [PreserveSig] int OpenPropertyStore(uint mode, out IPropertyStore store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetState(out uint state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out PropertyKey key);
  [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
  [PreserveSig] int Commit();
}

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
  [PreserveSig] int GetChannelCount(out uint channelCount);
  [PreserveSig] int SetMasterVolumeLevel(float levelDb, IntPtr eventContext);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr eventContext);
  [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, IntPtr eventContext);
  [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr eventContext);
  [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
  [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr eventContext);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
  [PreserveSig] int VolumeStepUp(IntPtr eventContext);
  [PreserveSig] int VolumeStepDown(IntPtr eventContext);
  [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
  [PreserveSig] int GetVolumeRange(out float min, out float max, out float increment);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
struct PropertyKey {
  public Guid FormatId;
  public uint PropertyId;
}

[StructLayout(LayoutKind.Explicit)]
struct PropVariant {
  [FieldOffset(0)] public ushort Type;
  [FieldOffset(8)] public IntPtr PointerValue;
}

[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr format, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, out long defaultPeriod, out long minimumPeriod);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, IntPtr value);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, IntPtr value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
}

public static class OrbitAudio {
  static IMMDeviceEnumerator CreateEnumerator() {
    return (IMMDeviceEnumerator)new AudioDeviceEnumerator();
  }

  static string FriendlyName(IMMDevice device) {
    IPropertyStore store;
    Marshal.ThrowExceptionForHR(device.OpenPropertyStore(0, out store));
    var key = new PropertyKey {
      FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
      PropertyId = 14
    };
    PropVariant value;
    Marshal.ThrowExceptionForHR(store.GetValue(ref key, out value));
    try {
      if (value.Type != 31 || value.PointerValue == IntPtr.Zero) return "Unknown device";
      return Marshal.PtrToStringUni(value.PointerValue);
    } finally {
      PropVariantClear(ref value);
      Marshal.ReleaseComObject(store);
    }
  }

  [DllImport("ole32.dll")]
  static extern int PropVariantClear(ref PropVariant value);

  static IMMDevice GetDefaultDevice(int dataFlow, int role) {
    var enumerator = CreateEnumerator();
    try {
      IMMDevice device;
      int result = enumerator.GetDefaultAudioEndpoint(dataFlow, role, out device);
      if (result != 0) return null;
      return device;
    } finally {
      Marshal.ReleaseComObject(enumerator);
    }
  }

  static IAudioEndpointVolume GetEndpointVolume(IMMDevice device) {
    Guid iid = typeof(IAudioEndpointVolume).GUID;
    IntPtr pointer;
    Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out pointer));
    try {
      return (IAudioEndpointVolume)Marshal.GetObjectForIUnknown(pointer);
    } finally {
      Marshal.Release(pointer);
    }
  }

  static object ReadOutput() {
    var device = GetDefaultDevice(0, 1);
    if (device == null) return null;
    try {
      string id;
      Marshal.ThrowExceptionForHR(device.GetId(out id));
      var volume = GetEndpointVolume(device);
      try {
        bool muted;
        Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
        float level;
        Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out level));
        return new { id = id, name = FriendlyName(device), muted = muted, volume = (int)Math.Round(level * 100) };
      } finally {
        Marshal.ReleaseComObject(volume);
      }
    } finally {
      Marshal.ReleaseComObject(device);
    }
  }

  static object ReadMicrophone() {
    var device = GetDefaultDevice(1, 2);
    if (device == null) return null;
    try {
      string id;
      Marshal.ThrowExceptionForHR(device.GetId(out id));
      var volume = GetEndpointVolume(device);
      try {
        bool muted;
        Marshal.ThrowExceptionForHR(volume.GetMute(out muted));
        return new { id = id, name = FriendlyName(device), muted = muted };
      } finally {
        Marshal.ReleaseComObject(volume);
      }
    } finally {
      Marshal.ReleaseComObject(device);
    }
  }

  public static object GetState() {
    return new { output = ReadOutput(), microphone = ReadMicrophone() };
  }

  public static void SetOutputMute(bool muted) {
    var device = GetDefaultDevice(0, 1);
    if (device == null) throw new InvalidOperationException("No active output device.");
    try {
      var volume = GetEndpointVolume(device);
      try {
        Marshal.ThrowExceptionForHR(volume.SetMute(muted, IntPtr.Zero));
      } finally {
        Marshal.ReleaseComObject(volume);
      }
    } finally {
      Marshal.ReleaseComObject(device);
    }
  }

  public static void SetMicrophoneMute(bool muted) {
    var device = GetDefaultDevice(1, 2);
    if (device == null) throw new InvalidOperationException("No active microphone.");
    try {
      var volume = GetEndpointVolume(device);
      try {
        Marshal.ThrowExceptionForHR(volume.SetMute(muted, IntPtr.Zero));
      } finally {
        Marshal.ReleaseComObject(volume);
      }
    } finally {
      Marshal.ReleaseComObject(device);
    }
  }

  public static void SetOutputVolume(int volume) {
    var device = GetDefaultDevice(0, 1);
    if (device == null) throw new InvalidOperationException("No active output device.");
    try {
      var endpoint = GetEndpointVolume(device);
      try {
        float level = Math.Max(0, Math.Min(100, volume)) / 100f;
        Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(level, IntPtr.Zero));
      } finally {
        Marshal.ReleaseComObject(endpoint);
      }
    } finally {
      Marshal.ReleaseComObject(device);
    }
  }

  public static object[] GetDevices() {
    var enumerator = CreateEnumerator();
    IMMDeviceCollection collection = null;
    try {
      Marshal.ThrowExceptionForHR(enumerator.EnumAudioEndpoints(0, 1, out collection));
      uint count;
      Marshal.ThrowExceptionForHR(collection.GetCount(out count));
      var result = new List<object>();
      for (uint i = 0; i < count; i++) {
        IMMDevice device = null;
        try {
          Marshal.ThrowExceptionForHR(collection.Item(i, out device));
          string id;
          Marshal.ThrowExceptionForHR(device.GetId(out id));
          result.Add(new { id = id, name = FriendlyName(device) });
        } finally {
          if (device != null) Marshal.ReleaseComObject(device);
        }
      }
      return result.ToArray();
    } finally {
      if (collection != null) Marshal.ReleaseComObject(collection);
      Marshal.ReleaseComObject(enumerator);
    }
  }

  public static string GetDefaultDeviceId() {
    var enumerator = CreateEnumerator();
    IMMDevice device = null;
    try {
      if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0) return null;
      string id;
      Marshal.ThrowExceptionForHR(device.GetId(out id));
      return id;
    } finally {
      if (device != null) Marshal.ReleaseComObject(device);
      Marshal.ReleaseComObject(enumerator);
    }
  }

  public static void SetDefaultDevice(string id) {
    var policyType = Type.GetTypeFromCLSID(new Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9"));
    var policy = (IPolicyConfig)Activator.CreateInstance(policyType);
    try {
      for (int role = 0; role < 3; role++) {
        Marshal.ThrowExceptionForHR(policy.SetDefaultEndpoint(id, role));
      }
    } finally {
      Marshal.ReleaseComObject(policy);
    }
  }
}
'@

switch ($env:ORBIT_AUDIO_ACTION) {
  'list' {
    ConvertTo-Json -InputObject ([OrbitAudio]::GetDevices()) -Compress -Depth 4
  }
  'default' {
    [OrbitAudio]::GetDefaultDeviceId()
  }
  'set' {
    [OrbitAudio]::SetDefaultDevice($env:ORBIT_AUDIO_DEVICE_ID)
    ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
  }
  'state' {
    ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
  }
  'set-output-mute' {
    [OrbitAudio]::SetOutputMute($env:ORBIT_AUDIO_MUTED -eq '1') | Out-Null
    ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
  }
  'set-mic-mute' {
    [OrbitAudio]::SetMicrophoneMute($env:ORBIT_AUDIO_MUTED -eq '1') | Out-Null
    ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
  }
  'set-volume' {
    [OrbitAudio]::SetOutputVolume([int]$env:ORBIT_AUDIO_VOLUME) | Out-Null
    ConvertTo-Json -InputObject ([OrbitAudio]::GetState()) -Compress -Depth 5
  }
  default {
    throw 'Unknown audio command.'
  }
}
`;

/**
 * Create the audio service.
 * @param {(action: string, payload?: object) => Promise<string>} runPowerShell
 * @param {() => string} getConfigPath Absolute path of output-devices.json
 * @param {typeof defaultFs} [fsImpl] File-system implementation for tests
 */
function createAudioService({ runPowerShell, getConfigPath, fsImpl = defaultFs }) {
  if (typeof runPowerShell !== "function") {
    throw new TypeError("runPowerShell must be a function.");
  }
  if (typeof getConfigPath !== "function") {
    throw new TypeError("getConfigPath must be a function.");
  }

  function parseState(output) {
    let state;
    try {
      state = JSON.parse(output || "null");
    } catch {
      throw new Error("The audio state could not be read.");
    }
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("The audio state could not be read.");
    }
    return {
      output: state.output ?? null,
      microphone: state.microphone ?? null
    };
  }

  async function getState() {
    let output;
    try {
      output = await runPowerShell("state");
    } catch {
      throw new Error("The audio state could not be read.");
    }
    return parseState(output);
  }

  async function listOutputDevices() {
    let output;
    try {
      output = await runPowerShell("list");
    } catch {
      throw new Error("The audio device list could not be read.");
    }

    try {
      const devices = JSON.parse(output || "[]");
      if (!Array.isArray(devices)) throw new Error("unexpected device list");
      return devices.filter((device) => typeof device?.id === "string" && typeof device?.name === "string");
    } catch {
      throw new Error("The audio device list could not be read.");
    }
  }

  async function getOutputPair() {
    try {
      const config = JSON.parse(await fsImpl.readFile(getConfigPath(), "utf8"));
      if (typeof config.headset?.id !== "string" || typeof config.monitor?.id !== "string") {
        throw new Error("invalid saved selection");
      }
      return config;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error("The saved output device selection could not be read.");
    }
  }

  async function saveOutputPair(input) {
    const headsetId = input?.headsetId;
    const monitorId = input?.monitorId;
    if (typeof headsetId !== "string" || typeof monitorId !== "string" || headsetId === monitorId) {
      throw new Error("Select two different output devices.");
    }

    const devices = await listOutputDevices();
    const headset = devices.find((device) => device.id === headsetId);
    const monitor = devices.find((device) => device.id === monitorId);
    if (!headset || !monitor) throw new Error("The selected output device is no longer available.");

    const config = {
      headset: { id: headset.id, name: headset.name },
      monitor: { id: monitor.id, name: monitor.name }
    };
    const configPath = getConfigPath();
    const temporaryPath = `${configPath}.tmp`;
    try {
      await fsImpl.writeFile(temporaryPath, JSON.stringify(config), { mode: 0o600 });
      await fsImpl.rename(temporaryPath, configPath);
    } catch {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw new Error("The output device selection could not be saved.");
    }
    return config;
  }

  async function setOutputMuted(muted) {
    if (typeof muted !== "boolean") {
      throw new Error("The output mute state must be true or false.");
    }

    let output;
    try {
      output = await runPowerShell("set-output-mute", { muted });
    } catch {
      throw new Error("The output device could not be muted.");
    }
    return parseState(output);
  }

  async function setMicrophoneMuted(muted) {
    if (typeof muted !== "boolean") {
      throw new Error("The microphone mute state must be true or false.");
    }

    let output;
    try {
      output = await runPowerShell("set-mic-mute", { muted });
    } catch {
      throw new Error("The microphone could not be muted.");
    }
    return parseState(output);
  }

  async function setOutputVolume(volume) {
    if (typeof volume !== "number" || !Number.isFinite(volume)) {
      throw new Error("The volume must be a number between 0 and 100.");
    }
    const normalized = Math.round(Math.min(100, Math.max(0, volume)));

    let output;
    try {
      output = await runPowerShell("set-volume", { volume: normalized });
    } catch {
      throw new Error("The volume could not be changed.");
    }
    return parseState(output);
  }

  async function toggleOutput() {
    const pair = await getOutputPair();
    if (!pair) throw new Error("Select your headset and monitor in Quick Actions first.");

    const devices = await listOutputDevices();
    const headset = devices.find((device) => device.id === pair.headset.id);
    const monitor = devices.find((device) => device.id === pair.monitor.id);
    if (!headset || !monitor) {
      throw new Error("A selected output device is unavailable. Re-select your devices in Quick Actions.");
    }

    let currentId;
    try {
      currentId = await runPowerShell("default");
    } catch {
      throw new Error("The output device could not be switched.");
    }

    const target = currentId === headset.id ? monitor : headset;
    let output;
    try {
      output = await runPowerShell("set", { deviceId: target.id });
    } catch {
      throw new Error("The output device could not be switched.");
    }
    const state = parseState(output);
    return { ok: true, message: `Output switched to ${target.name}.`, state };
  }

  return {
    listOutputDevices,
    getOutputPair,
    saveOutputPair,
    toggleOutput,
    getState,
    setOutputMuted,
    setMicrophoneMuted,
    setOutputVolume
  };
}

module.exports = { AUDIO_DEVICE_SCRIPT, createAudioService };
