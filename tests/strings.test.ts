import { expect, test } from "bun:test";
import { strings, t } from "../src/shared/strings";

test("every key exists in both languages", () => {
  expect(Object.keys(strings.es).sort()).toEqual(Object.keys(strings.en).sort());
});

test("interpolates variables", () => {
  expect(t("en", "quiet.because", { name: "League of Legends" })).toBe("Quiet because: League of Legends");
  expect(t("es", "quiet.because", { name: "League of Legends" })).toBe("Silencio por: League of Legends");
});

test("missing variables are left visible, not blank", () => {
  expect(t("en", "quiet.because")).toBe("Quiet because: {name}");
});
