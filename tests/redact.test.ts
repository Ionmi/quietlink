import { expect, test } from "bun:test";
import { redact } from "../src/domain/redact";

test("redacts user, home, ipv4, ipv6, targets, gateway ids", () => {
  const out = redact("alex /Users/alex/x 192.168.1.1 fe80::1c2b:3aff:fe4d:5e6f 1.1.1.1 abcd1234", {
    username: "alex", home: "/Users/alex", targets: ["1.1.1.1"], gatewayIds: ["abcd1234"],
  });
  expect(out).toBe("<user> <home>/x <ipv4> <ipv6> <target> <gateway>");
});

test("does not mangle times or version numbers", () => {
  const out = redact("19:13:38 macOS 27.0 p95 100 ms", { username: "alex", home: "/Users/alex", targets: [], gatewayIds: [] });
  expect(out).toBe("19:13:38 macOS 27.0 p95 100 ms");
});

test("redacts mac addresses", () => {
  expect(redact("router 0a:1b:2c:3d:4e:5f", { username: "u", home: "/Users/u", targets: [], gatewayIds: [] })).toBe("router <mac>");
});
