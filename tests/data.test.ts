import { describe, expect, it } from "vitest";
import { newScanId } from "../src/data";

describe("scan identifiers", () => {
  it("creates distinct IDs for repeated uploads of the same Pokémon", () => {
    const ids = new Set(Array.from({ length: 4 }, () => newScanId()));
    expect(ids.size).toBe(4);
  });
});
