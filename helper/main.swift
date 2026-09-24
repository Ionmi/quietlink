import Foundation

let args = CommandLine.arguments
if args.contains("--screens") {
  let data = try! JSONSerialization.data(withJSONObject: screensSnapshot())
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
  exit(0)
}
FileHandle.standardError.write("usage: quietlink-helper --screens\n".data(using: .utf8)!)
exit(64)
