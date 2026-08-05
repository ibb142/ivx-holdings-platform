import { expect, test } from "bun:test";

test("node:test compatibility — basic assertion", () => {
  expect(1 + 1).toBe(2);
});
