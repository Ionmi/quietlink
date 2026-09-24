import Darwin
import Foundation

/// Byte counters from the link-layer if_data. They are 32-bit and wrap at 4 GiB;
/// the app computes rates from 1 s deltas modulo 2^32, which is exact below 4 GiB/s.
func interfaceBytes(_ name: String) -> (rx: UInt64, tx: UInt64)? {
  var ifap: UnsafeMutablePointer<ifaddrs>?
  guard getifaddrs(&ifap) == 0, let first = ifap else { return nil }
  defer { freeifaddrs(ifap) }
  var cur: UnsafeMutablePointer<ifaddrs>? = first
  while let c = cur {
    if String(cString: c.pointee.ifa_name) == name, let addr = c.pointee.ifa_addr, addr.pointee.sa_family == UInt8(AF_LINK),
       let data = c.pointee.ifa_data {
      let d = data.assumingMemoryBound(to: if_data.self).pointee
      return (UInt64(d.ifi_ibytes), UInt64(d.ifi_obytes))
    }
    cur = c.pointee.ifa_next
  }
  return nil
}

final class TrafficSensor {
  private var timer: Timer?
  var iface: () -> String?

  init(iface: @escaping () -> String?) { self.iface = iface }

  func start() {
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
      guard let self, let name = self.iface(), let b = interfaceBytes(name) else { return }
      emit(["type": "traffic", "iface": name, "rxBytes": b.rx, "txBytes": b.tx])
    }
  }
}
