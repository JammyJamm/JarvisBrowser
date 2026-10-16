import { render, screen } from "@testing-library/react";
import App from "./App";
import { getDoc, getDocs } from "firebase/firestore";

jest.mock("./firebaseConfig", () => ({ __esModule: true, default: {} }));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  Timestamp: class Timestamp {},
}));

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

  getDocs.mockResolvedValue({ docs: [{ id: "2026-10-16" }] });
  getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({ "12:00": [values] }),
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
  getDocs.mockResolvedValue({ docs: [{ id: "2026-10-16" }] });
  getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
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
    }),
  });

  const { container } = render(<App />);

  expect(await screen.findByText("Baccarat road board")).toBeInTheDocument();
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

test("highlights matching values and displays each result's previous value", async () => {
  getDocs.mockResolvedValue({ docs: [{ id: "2026-10-16" }] });
  getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
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
    }),
  });

  const { container } = render(<App />);

  expect(
    await screen.findByText("Matching values and their previous results"),
  ).toBeInTheDocument();
  expect(screen.getByText("4", { selector: ".matching-pair-value" })).toBeInTheDocument();
  expect(screen.getByText("Results 2 & 3")).toBeInTheDocument();
  expect(screen.getByText("Previous: 7 & 4")).toBeInTheDocument();
  expect(container.querySelectorAll(".baccarat-cell.paired")).toHaveLength(2);
});

test("does not pair equal values separated by a different result", async () => {
  getDocs.mockResolvedValue({ docs: [{ id: "2026-10-16" }] });
  getDoc.mockResolvedValue({
    exists: () => true,
    data: () => ({
      coordinateHistory: {
        found: true,
        count: 3,
        results: [
          { x: 0, y: 0, result: "Banker", value: "4", markers: [] },
          { x: 1, y: 0, result: "Player", value: "7", markers: [] },
          { x: 2, y: 0, result: "Banker", value: "4", markers: [] },
        ],
      },
    }),
  });

  const { container } = render(<App />);

  expect(await screen.findByText("Baccarat road board")).toBeInTheDocument();
  expect(screen.queryByText("Matching values and their previous results")).toBeNull();
  expect(container.querySelectorAll(".baccarat-cell.paired")).toHaveLength(0);
});
