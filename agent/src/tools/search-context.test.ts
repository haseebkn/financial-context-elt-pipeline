import { afterEach, describe, expect, it, vi } from "vitest";
import { searchContextTool } from "./search-context.js";

describe("search_context tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds the request URL with query params and the auth header", async () => {
    const fetchMock = vi.fn(async (url: URL, _init?: RequestInit) => {
      expect(url.pathname).toBe("/api/search");
      expect(url.searchParams.get("q")).toBe("coffee shop");
      expect(url.searchParams.get("limit")).toBe("5");
      expect(url.searchParams.get("source")).toBe("plaid");
      return new Response(JSON.stringify({ query: "coffee shop", results: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchContextTool.run({ query: "coffee shop", limit: 5, source: "plaid" });

    const [urlArg, initArg] = fetchMock.mock.calls[0]!;
    expect((initArg as RequestInit).headers).toMatchObject({ "X-Internal-Token": "test-internal-token" });
  });

  it("returns formatted results with rounded similarity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            query: "coffee",
            results: [
              {
                row_id: "plaid_t1",
                document: "Financial Transaction: Spent $4.50 at Corner Coffee",
                source: "plaid",
                record_date: "2026-01-02 09:00:00",
                distance: 0.123456,
                similarity: 0.876544,
              },
            ],
          }),
          { status: 200 }
        )
      )
    );

    const result = (await searchContextTool.run({ query: "coffee", limit: 5 })) as string;
    const parsed = JSON.parse(result);
    expect(parsed[0].row_id).toBe("plaid_t1");
    expect(parsed[0].similarity).toBe(0.877); // rounded to 3dp
  });

  it("returns a clear no-results message rather than an empty array", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ query: "xyz", results: [] }), { status: 200 }))
    );

    const result = (await searchContextTool.run({ query: "xyz", limit: 5 })) as string;
    expect(result).toMatch(/No results found for "xyz"/);
  });

  it("surfaces a non-200 response from the retrieval service usefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unauthorized", { status: 401 }))
    );

    const result = (await searchContextTool.run({ query: "coffee", limit: 5 })) as string;
    expect(result).toMatch(/search_context failed/);
    expect(result).toMatch(/401/);
  });
});
