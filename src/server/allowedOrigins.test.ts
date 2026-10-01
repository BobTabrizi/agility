import { describe, expect, it } from "vitest";
import { allowedOrigins, isAllowedOrigin } from "@/server/allowedOrigins";

describe("allowedOrigins", () => {
  it("is null (any origin) when unset or blank", () => {
    expect(allowedOrigins(undefined)).toBeNull();
    expect(allowedOrigins("")).toBeNull();
    expect(allowedOrigins(" , ")).toBeNull();
  });

  it("parses a comma-separated list, trimming, lowercasing and dropping trailing slashes", () => {
    expect(allowedOrigins(" https://Agility.Example/ , http://localhost:3000")).toEqual([
      "https://agility.example",
      "http://localhost:3000",
    ]);
  });
});

describe("isAllowedOrigin", () => {
  const allowed = ["https://agility.example"];

  it("allows everything when no origins are configured", () => {
    expect(isAllowedOrigin("https://elsewhere.example", null)).toBe(true);
    expect(isAllowedOrigin(undefined, null)).toBe(true);
  });

  it("allows a listed origin, however it's cased", () => {
    expect(isAllowedOrigin("https://agility.example", allowed)).toBe(true);
    expect(isAllowedOrigin("https://AGILITY.example", allowed)).toBe(true);
  });

  it("refuses other sites, other schemes and other ports", () => {
    expect(isAllowedOrigin("https://elsewhere.example", allowed)).toBe(false);
    expect(isAllowedOrigin("http://agility.example", allowed)).toBe(false);
    expect(isAllowedOrigin("https://agility.example:8443", allowed)).toBe(false);
    expect(isAllowedOrigin("https://agility.example.evil.example", allowed)).toBe(false);
    expect(isAllowedOrigin("null", allowed)).toBe(false);
  });

  it("allows requests without an Origin (not from a web page)", () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
  });
});
