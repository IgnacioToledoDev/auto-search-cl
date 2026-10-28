import { describe, expect, it } from "vitest";
import { dedupeKey } from "../../src/lib/key.ts";

describe("dedupeKey", () => {
  it("uses the normalized plate when present", () => {
    expect(dedupeKey({ portal: "yapo", id: "1", plate: "ab-cd-12" })).toBe("ABCD12");
    expect(dedupeKey({ portal: "yapo", id: "1", plate: " bbcc 34 " })).toBe("BBCC34");
  });
  it("is identical across portals for the same plate", () => {
    const a = dedupeKey({ portal: "yapo", id: "1", plate: "ABCD12" });
    const b = dedupeKey({ portal: "chileautos", id: "99", plate: "AB-CD-12" });
    expect(a).toBe(b);
  });
  it("falls back to portal:id when plate is null or blank", () => {
    expect(dedupeKey({ portal: "yapo", id: "77", plate: null })).toBe("yapo:77");
    expect(dedupeKey({ portal: "yapo", id: "77", plate: "  -- " })).toBe("yapo:77");
  });
});
