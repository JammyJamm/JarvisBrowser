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
