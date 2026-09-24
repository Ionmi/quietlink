import Foundation
import SystemConfiguration

/// Interface-scoped IPv4 router (covers DHCP and static setups) plus its MAC from
/// the network signature, falling back to the ARP table.
func routerSnapshot(iface: String?) -> [String: Any] {
  var ipv4: String?
  var mac: String?
  if let iface, let store = SCDynamicStoreCreate(nil, "quietlink" as CFString, nil, nil),
     let keys = SCDynamicStoreCopyKeyList(store, "State:/Network/Service/[^/]+/IPv4" as CFString) as? [String] {
    for key in keys {
      guard let d = SCDynamicStoreCopyValue(store, key as CFString) as? [String: Any],
            (d["InterfaceName"] as? String) == iface else { continue }
      ipv4 = d["Router"] as? String
      if let sig = d["NetworkSignature"] as? String,
         let r = sig.range(of: "IPv4.RouterHardwareAddress=") {
        mac = String(sig[r.upperBound...].prefix { $0 != ";" })
      }
      break
    }
  }
  if mac == nil, let ip = ipv4 { mac = arpLookup(ip) }
  return ["type": "router", "iface": orNull(iface), "ipv4": orNull(ipv4), "mac": orNull(mac)]
}

private func arpLookup(_ ip: String) -> String? {
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/arp")
  p.arguments = ["-n", ip]
  let pipe = Pipe()
  p.standardOutput = pipe
  p.standardError = FileHandle.nullDevice
  guard (try? p.run()) != nil else { return nil }
  p.waitUntilExit()
  let out = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
  guard let r = out.range(of: #"at ([0-9a-f:]{11,17})"#, options: .regularExpression) else { return nil }
  return String(out[r].dropFirst(3))
}
