import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// A self-signed code-signing certificate that lives only in this Mac's login keychain.
// Signing every build and every downloaded update with it keeps the same identity,
// so macOS privacy permissions (Local Network) and firewalls stay granted.
// Free: no Apple Developer account involved.
export const LOCAL_IDENTITY = "Quietlink Local";

const run = (argv: string[]) => {
  const p = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
};

/** SHA-1 of the local signing identity, or null if it doesn't exist. */
export function findLocalIdentity(): string | null {
  const m = new RegExp(`\\b([A-F0-9]{40}) "${LOCAL_IDENTITY}"`).exec(run(["/usr/bin/security", "find-identity", "-p", "codesigning"]).out);
  return m ? m[1] : null;
}

/** Creates the identity once (openssl + security import). Returns its SHA-1 or null. */
export function ensureLocalIdentity(): string | null {
  const found = findLocalIdentity();
  if (found) return found;
  const dir = mkdtempSync(join(tmpdir(), "ql-id-"));
  try {
    writeFileSync(join(dir, "cfg"), `[req]\ndistinguished_name = dn\nx509_extensions = ext\nprompt = no\n[dn]\nCN = ${LOCAL_IDENTITY}\n[ext]\nbasicConstraints = critical,CA:false\nkeyUsage = critical,digitalSignature\nextendedKeyUsage = critical,codeSigning\n`);
    if (run(["/usr/bin/openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k"), "-out", join(dir, "c"), "-days", "3650", "-config", join(dir, "cfg")]).code !== 0) return null;
    const pass = crypto.randomUUID();
    if (run(["/usr/bin/openssl", "pkcs12", "-export", "-inkey", join(dir, "k"), "-in", join(dir, "c"), "-out", join(dir, "p"), "-passout", `pass:${pass}`, "-name", LOCAL_IDENTITY]).code !== 0) return null;
    run(["/usr/bin/security", "import", join(dir, "p"), "-k", join(homedir(), "Library/Keychains/login.keychain-db"), "-P", pass, "-T", "/usr/bin/codesign"]);
    return findLocalIdentity();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Signs every Mach-O inside the app, then the nested helper app, then the app itself. */
export function signApp(app: string, identity: string): boolean {
  const machO = run(["/usr/bin/find", app, "-type", "f", "-perm", "+111"]).out.split("\n").filter(Boolean)
    .filter((f) => run(["/usr/bin/file", "-b", f]).out.startsWith("Mach-O"));
  const sign = (target: string, id?: string) =>
    run(["/usr/bin/codesign", "--force", "--sign", identity, "--timestamp=none", ...(id ? ["--identifier", id] : []), target]).code === 0;
  const helper = join(app, "Contents/Resources/app/helper/Quietlink Helper.app");
  for (const f of machO) if (!f.startsWith(helper + "/") && !f.endsWith("/Contents/MacOS/launcher")) if (!sign(f)) return false;
  if (Bun.file(join(helper, "Contents/Info.plist")).size && !sign(helper, "dev.quietlink.helper")) return false;
  if (!sign(app)) return false;
  return run(["/usr/bin/codesign", "--verify", "--deep", "--strict", app]).code === 0;
}
