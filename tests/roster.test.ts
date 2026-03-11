import { describe, expect, it } from "vitest";

import { parseRosterCsv } from "@/lib/roster";

describe("parseRosterCsv", () => {
  it("normalizes null names and tolerates missing optional columns", () => {
    const members = parseRosterCsv(`Login,Name,Role\nfoo,null,MEMBER`);

    expect(members).toEqual([
      {
        login: "foo",
        name: "foo",
        email: null,
        createdAt: null,
        role: "MEMBER",
      },
    ]);
  });
});
