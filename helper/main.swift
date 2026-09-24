import AppKit
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)
let args = CommandLine.arguments

func printJSON(_ obj: Any) {
  let data = try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys])
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0A]))
}

if args.contains("--screens") {
  printJSON(screensSnapshot())
  exit(0)
}

if args.contains("--test-warden") {
  exit(runWardenTests())
}

if let i = args.firstIndex(of: "--render-tray"), i + 1 < args.count,
   let data = args[i + 1].data(using: .utf8), let cmd = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
  TrayRenderer.handle(cmd)
  flushOutput()
  exit(0)
}

if args.contains("--selftest") {
  exit(runSelftest())
}

if args.contains("--warden") {
  WardenServer().run()
}

if args.contains("--sensor") {
  runSensor()
}

logError("usage: quietlink-helper --sensor | --warden | --selftest | --test-warden | --screens")
exit(64)
