import { expect, test } from "bun:test";

test("electrobun config declares both views and the helper copy", async () => {
  const config = (await import("../electrobun.config.ts")).default;
  expect(Object.keys(config.build.views)).toEqual(["popover", "settings"]);
  expect(config.build.copy["build/helper/quietlink-helper"]).toBe("helper/quietlink-helper");
  expect(config.app.identifier).toBe("dev.quietlink.app");
});
