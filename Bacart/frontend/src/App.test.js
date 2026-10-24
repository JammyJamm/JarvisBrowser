import { render, screen } from "@testing-library/react";
import App from "./App";

const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

function mockRoundHistory(data) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => data,
  });
}

test("renders every value from a nested result array", async () => {
  const values = [
    "6",
    "9",
    "4",
    "9",
    "9",
    "9",
    "8",
    "9",
    "7",
    "7",
    "6",
    "9",
    "9",
    "7",
    "9",
    "7",
    "9",
    "7",
    "7",
    "2",
    "9",
    "8",
    "7",
    "6",
    "8",
    "6",
    "7",
    "3",
    "9",
    "7",
    "9",
    "7",
    "8",
    "6",
    "7",
    "6",
    "8",
    "6",
    "8",
    "5",
    "9",
    "5",
    "8",
    "8",
    "9",
    "7",
    "8",
  ];

  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    parsedSvgRounds: [values],
  });

  const { container } = render(<App />);

  expect(await screen.findByText("47 results")).toBeInTheDocument();
  expect(container.querySelectorAll(".result-tile")).toHaveLength(values.length);
  expect(container.querySelector(".result-tile .result-value")).toHaveTextContent(
    "6",
  );
  expect(container.querySelectorAll(".result-tile .result-value")[46]).toHaveTextContent(
    "8",
  );
});

test("renders saved coordinate history on the Baccarat board", async () => {
  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    coordinateHistory: {
        found: true,
        count: 2,
        results: [
          {
            x: 0,
            y: 0,
            result: "Banker",
            value: "4",
            color: "#EC2024",
            markers: [],
          },
          {
            x: 1,
            y: 0,
            result: "Player",
            value: "8",
            color: "#2475D0",
            markers: [{ fill: "#EC2024", cx: "4", cy: "4", r: "2" }],
          },
        ],
    },
  });

  const { container } = render(<App />);

  expect(await screen.findByText("Baccarat road board")).toBeInTheDocument();
  expect(mockFetch).toHaveBeenCalledWith(
    "http://localhost:9000/round-history",
    { cache: "no-store" },
  );
  expect(screen.getByText("Banker · 1")).toBeInTheDocument();
  expect(screen.getByText("Player · 1")).toBeInTheDocument();
  expect(container.querySelectorAll(".baccarat-cell")).toHaveLength(2);
  expect(container.querySelector(".baccarat-grid").style.gridTemplateColumns).toBe(
    "repeat(2, 64px)",
  );
  expect(container.querySelectorAll(".baccarat-value")[0]).toHaveTextContent(
    "4",
  );
  expect(container.querySelectorAll(".baccarat-marker")).toHaveLength(1);
});

test("highlights matching values without rendering the previous-results section", async () => {
  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    coordinateHistory: {
        found: true,
        count: 3,
        results: [
          {
            x: 0,
            y: 0,
            result: "Banker",
            value: "7",
            color: "#EC2024",
            markers: [],
          },
          {
            x: 1,
            y: 0,
            result: "Player",
            value: "4",
            color: "#2475D0",
            markers: [],
          },
          {
            x: 2,
            y: 0,
            result: "Banker",
            value: "4",
            color: "#EC2024",
            markers: [],
          },
        ],
    },
  });

  const { container } = render(<App />);

  expect(await screen.findByText("Baccarat road board")).toBeInTheDocument();
  expect(
    screen.queryByText("Matching values and their previous results"),
  ).toBeNull();
  expect(container.querySelectorAll(".baccarat-cell.paired")).toHaveLength(2);
});

test("does not pair equal values separated by a different result", async () => {
  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    coordinateHistory: {
        found: true,
        count: 3,
        results: [
          { x: 0, y: 0, result: "Banker", value: "4", markers: [] },
          { x: 1, y: 0, result: "Player", value: "7", markers: [] },
          { x: 2, y: 0, result: "Banker", value: "4", markers: [] },
        ],
    },
  });

  const { container } = render(<App />);

  expect(await screen.findByText("Baccarat road board")).toBeInTheDocument();
  expect(screen.queryByText("Matching values and their previous results")).toBeNull();
  expect(container.querySelectorAll(".baccarat-cell.paired")).toHaveLength(0);
});

test("shows the prior three values, matching pair, and Banker or Player target", async () => {
  const values = [
    ["Player", "8"],
    ["Banker", "6"],
    ["Player", "5"],
    ["Player", "7"],
    ["Banker", "7"],
    ["Banker", "9"],
    ["Player", "4"],
    ["Player", "3"],
    ["Banker", "3"],
    ["Player", "2"],
  ];

  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    coordinateHistory: {
        found: true,
        count: values.length,
        results: values.map(([result, value], x) => ({
          x,
          y: 0,
          result,
          value,
          color: x === 5 ? "#b51e2b" : x === 9 ? "#1768bd" : null,
          markers: [],
        })),
    },
  });

  const { container } = render(<App />);

  expect(
    await screen.findByText("Consecutive number signals"),
  ).toBeInTheDocument();
  const bankerSignal = container.querySelector(".sequence-signal.banker");
  const playerSignal = container.querySelector(".sequence-signal.player");

  expect(bankerSignal).toHaveTextContent("Banker target");
  expect(
    Array.from(bankerSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.textContent,
    ),
  ).toEqual(["8", "6", "5", "7", "7", "9"]);
  expect(playerSignal).toHaveTextContent("Player target");
  expect(
    Array.from(playerSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.textContent,
    ),
  ).toEqual(["7", "9", "4", "3", "3", "2"]);
  expect(bankerSignal.style.getPropertyValue("--signal-color")).toBe("#b51e2b");
  expect(playerSignal.style.getPropertyValue("--signal-color")).toBe("#1768bd");
  expect(
    Array.from(bankerSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.style.getPropertyValue("--result-color"),
    ),
  ).toEqual([
    "#2475d0",
    "#ec2024",
    "#2475d0",
    "#2475d0",
    "#ec2024",
    "#b51e2b",
  ]);
  expect(
    Array.from(playerSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.style.getPropertyValue("--result-color"),
    ),
  ).toEqual([
    "#ec2024",
    "#b51e2b",
    "#2475d0",
    "#2475d0",
    "#ec2024",
    "#1768bd",
  ]);

  const latestSignal = container.querySelector(".sequence-signal.pending");
  expect(latestSignal).toHaveTextContent("Latest results · next");
  expect(
    Array.from(latestSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.textContent,
    ),
  ).toEqual(["4", "3", "3", "2", "-"]);
  expect(
    Array.from(latestSignal.querySelectorAll(".sequence-signal-value")).map(
      (tile) => tile.style.getPropertyValue("--result-color"),
    ),
  ).toEqual(["#2475d0", "#2475d0", "#ec2024", "#1768bd", ""]);
});

test("shows placeholders when a matching pair has fewer than three prior results", async () => {
  const values = [
    ["Player", "8"],
    ["Banker", "5"],
    ["Player", "5"],
    ["Banker", "9"],
  ];

  mockRoundHistory({
    success: true,
    dateId: "2026-10-16",
    coordinateHistory: {
        found: true,
        count: values.length,
        results: values.map(([result, value], x) => ({
          x,
          y: 0,
          result,
          value,
          markers: [],
        })),
    },
  });

  const { container } = render(<App />);
  const bankerSignal = await screen.findByText("Banker target");

  expect(
    Array.from(
      bankerSignal.parentElement.querySelectorAll(".sequence-signal-value"),
    ).map((tile) => tile.textContent),
  ).toEqual(["-", "-", "8", "5", "5", "9"]);
  expect(
    Array.from(
      bankerSignal.parentElement.querySelectorAll(".sequence-signal-value"),
    ).map((tile) => tile.style.getPropertyValue("--result-color")),
  ).toEqual(["", "", "#2475d0", "#ec2024", "#2475d0", "#ec2024"]);
});

test("shows round-history API errors instead of reading Firebase data", async () => {
  mockFetch.mockResolvedValue({
    ok: false,
    status: 503,
    json: async () => ({
      success: false,
      error: "Game iframe is not ready. Open the game and try again.",
    }),
  });
  jest.spyOn(console, "error").mockImplementation(() => {});

  render(<App />);

  expect(
    await screen.findByText(
      "Game iframe is not ready. Open the game and try again.",
    ),
  ).toBeInTheDocument();
});
