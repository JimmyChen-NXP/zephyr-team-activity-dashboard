import { describe, expect, it } from "vitest";

import { parseRosterCsv } from "@/lib/roster";

describe("parseRosterCsv", () => {
  it("normalizes null names and empty emails", () => {
    const members = parseRosterCsv(`Login,Name,Email,Created At,Role\nfoo,null,,2024-01-01T00:00:00Z,MEMBER`);

    expect(members).toEqual([
      {
        login: "foo",
        name: "foo",
        email: null,
        createdAt: "2024-01-01T00:00:00Z",
        role: "MEMBER",
      },
    ]);
  });
});
