import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";

const LOCK_EX = 2;
const LOCK_NB = 4;
const LOCK_UN = 8;

const libc = dlopen("/usr/lib/libSystem.B.dylib", {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

/** OS-held exclusive lock: released automatically if the process dies. */
export function acquireInstanceLock(path: string): { release(): void } | null {
  const fd = openSync(path, "a", 0o600);
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) !== 0) {
    closeSync(fd);
    return null;
  }
  return {
    release() {
      libc.symbols.flock(fd, LOCK_UN);
      closeSync(fd);
    },
  };
}
