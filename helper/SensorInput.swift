import CoreAudio
import Foundation

/// "An input device is running": heuristic for calls. Covers browser calls but
/// cannot tell which app uses the device, and duplex devices may report playback.
final class InputSensor {
  private var devices: [AudioObjectID] = []
  private var last: Bool?? = .none
  private var timer: Timer?
  private let queue = DispatchQueue.main
  private lazy var deviceListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.publish() }
  private lazy var systemListener: AudioObjectPropertyListenerBlock = { [weak self] _, _ in self?.rescan() }

  func start() {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, queue, systemListener)
    addr.mSelector = kAudioHardwarePropertyDefaultInputDevice
    AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &addr, queue, systemListener)
    rescan()
    timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.publish(force: true) }
  }

  private func rescan() {
    var addr = runningAddress()
    for d in devices { AudioObjectRemovePropertyListenerBlock(d, &addr, queue, deviceListener) }
    devices = inputDevices()
    for d in devices { AudioObjectAddPropertyListenerBlock(d, &addr, queue, deviceListener) }
    publish(force: true)
  }

  private func runningAddress() -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  }

  func active() -> Bool? {
    var any = false
    var addr = runningAddress()
    for d in devices {
      var v: UInt32 = 0
      var size = UInt32(MemoryLayout<UInt32>.size)
      guard AudioObjectGetPropertyData(d, &addr, 0, nil, &size, &v) == noErr else { return nil }
      if v != 0 { any = true }
    }
    return any
  }

  func publish(force: Bool = false) {
    let a = active()
    if force || last == .none || last! != a {
      last = .some(a)
      emit(["type": "input-active", "active": orNull(a)])
    }
  }
}

func inputDevices() -> [AudioObjectID] {
  var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDevices, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &ids) == noErr else { return [] }
  return ids.filter { id in
    var a = AudioObjectPropertyAddress(mSelector: kAudioDevicePropertyStreams, mScope: kAudioDevicePropertyScopeInput, mElement: kAudioObjectPropertyElementMain)
    var s: UInt32 = 0
    return AudioObjectGetPropertyDataSize(id, &a, 0, nil, &s) == noErr && s > 0
  }
}
