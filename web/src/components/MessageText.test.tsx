import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageText } from "./MessageText.js";

describe("MessageText", () => {
  it("renders agent markdown tables as semantic tables", () => {
    render(
      <MessageText text={"| Category | Total |\n|---|---:|\n| Food and Drink | **$4,422.92** |"} />
    );

    const table = screen.getByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Category" })).toBeInTheDocument();
    expect(within(table).getByText("$4,422.92").tagName).toBe("STRONG");
  });

  it("renders citations inside table cells as source chips", () => {
    render(
      <MessageText text={"| Merchant | Amount |\n|---|---:|\n| Starbucks [plaid_a] | $4.33 |"} />
    );

    expect(screen.getByTitle("plaid_a")).toBeInTheDocument();
  });
});
