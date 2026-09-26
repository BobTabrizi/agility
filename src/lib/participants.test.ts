import { describe, expect, it } from "vitest";
import { MAX_DISPLAY_NAME_LENGTH, truncateName } from "@/lib/participants";

describe("truncateName", () => {
  it("leaves a name at or under the limit unchanged", () => {
    expect(truncateName("Dana")).toBe("Dana");
    const exact = "x".repeat(MAX_DISPLAY_NAME_LENGTH);
    expect(truncateName(exact)).toBe(exact);
  });

  it("cuts a longer name to the limit and adds an ellipsis", () => {
    const long = "a".repeat(MAX_DISPLAY_NAME_LENGTH + 5);
    expect(truncateName(long)).toBe(`${"a".repeat(MAX_DISPLAY_NAME_LENGTH)}…`);
  });

  it("doesn't leave a space dangling before the ellipsis", () => {
    expect(truncateName("Alexandria Ocasio Smith-Worthington", 11)).toBe("Alexandria…");
  });
});
