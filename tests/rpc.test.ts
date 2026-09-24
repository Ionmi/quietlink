import { expect, test } from "bun:test";
import { dispatch } from "../src/main/rpc-api";

test("dispatch only reaches own api methods", () => {
  const api: any = { view: () => 1 };
  expect(dispatch(api, "view", [])).toBe(1);
  expect(() => dispatch(api, "toString", [])).toThrow("unknown method");
  expect(() => dispatch(api, "__proto__", [])).toThrow("unknown method");
  expect(() => dispatch(api, "constructor", [])).toThrow("unknown method");
});
