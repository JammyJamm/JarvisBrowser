// snapshot-parser.js

export default class SnapshotParser {
  constructor(snapshot) {
    this.raw = snapshot;
    this.text = this.extractText(snapshot);
    this.elements = this.parse();
  }

  // ------------------------------------------------
  // Extract snapshot text
  // ------------------------------------------------

  extractText(snapshot) {
    if (!snapshot) return "";

    if (typeof snapshot === "string") {
      return snapshot;
    }

    if (snapshot.content) {
      return snapshot.content.map((x) => x.text || "").join("\n");
    }

    if (snapshot.text) {
      return snapshot.text;
    }

    return JSON.stringify(snapshot);
  }

  // ------------------------------------------------
  // Normalize text
  // ------------------------------------------------

  normalize(text = "") {
    return (
      text
        .toLowerCase()

        // remove common ui words
        .replace(
          /\b(button|buttons|link|links|textbox|textboxes|input|inputs|field|fields|checkbox|checkboxes|radio|radios|menu|dropdown|combobox|option|tab|image|img)\b/g,
          "",
        )

        // remove punctuation
        .replace(/[^\w\s]/g, " ")

        // collapse spaces
        .replace(/\s+/g, " ")

        .trim()
    );
  }

  // ------------------------------------------------
  // Parse snapshot
  // ------------------------------------------------

  parse() {
    const lines = this.text.split("\n");

    const elements = [];

    for (const line of lines) {
      const item = this.parseLine(line);

      if (item) {
        elements.push(item);
      }
    }

    return elements;
  }

  // ------------------------------------------------
  // Parse one line
  // ------------------------------------------------

  parseLine(line) {
    if (!line) return null;

    const ref =
      line.match(/ref=([a-zA-Z0-9_-]+)/i) ||
      line.match(/\[ref=([a-zA-Z0-9_-]+)\]/i);

    if (!ref) return null;

    const target = ref[1];

    const roleMatch = line.match(
      /^(button|link|textbox|input|checkbox|radio|combobox|option|menuitem|tab|heading|image|img|textarea|listitem|cell|row|dialog|iframe)/i,
    );

    const role = roleMatch ? roleMatch[1].toLowerCase() : "unknown";

    const quoted = line.match(/"(.*?)"/);

    const name = quoted ? quoted[1].trim() : "";

    return {
      target,
      role,
      name,
      line,

      searchable: this.normalize(role + " " + name + " " + line),
    };
  }

  // ------------------------------------------------

  all() {
    return this.elements;
  }

  // ------------------------------------------------
  // Exact
  // ------------------------------------------------

  findExact(query) {
    query = this.normalize(query);

    return this.elements.find((e) => this.normalize(e.name) === query) || null;
  }

  // ------------------------------------------------
  // Contains
  // ------------------------------------------------

  findContains(query) {
    query = this.normalize(query);

    return (
      this.elements.find((e) => {
        const text = this.normalize(e.searchable);

        return (
          text.includes(query) ||
          query.includes(text) ||
          text.startsWith(query) ||
          text.endsWith(query) ||
          query.includes(text)
        );
      }) || null
    );
  }

  // ------------------------------------------------
  // Better scoring
  // ------------------------------------------------

  score(candidate, query) {
    candidate = this.normalize(candidate);
    query = this.normalize(query);

    if (!candidate || !query) return 0;

    if (candidate === query) return 100;

    if (candidate.startsWith(query)) return 95;

    if (candidate.endsWith(query)) return 90;

    if (candidate.includes(query)) return 85;

    if (query.includes(candidate)) return 80;

    let score = 0;

    const words = query.split(" ");

    for (const w of words) {
      if (candidate.includes(w)) {
        score += 15;
      }
    }

    return score;
  }

  // ------------------------------------------------
  // Best fuzzy
  // ------------------------------------------------

  findBest(query) {
    let best = null;
    let bestScore = 0;

    for (const e of this.elements) {
      const s = this.score(e.searchable, query);

      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }

    return best;
  }

  // ------------------------------------------------
  // Get target
  // ------------------------------------------------

  getTarget(query) {
    query = this.normalize(query);

    // remove common words
    query = query
      .replace(/\blearn more button\b/g, "learn more")
      .replace(/\bbutton\b/g, "")
      .replace(/\blink\b/g, "")
      .trim();

    let e = this.findExact(query);
    if (e) return e.target;

    e = this.findContains(query);
    if (e) return e.target;

    e = this.findBest(query);
    if (e) return e.target;

    return null;
  }

  // ------------------------------------------------
  // Get element
  // ------------------------------------------------

  get(query) {
    let e = this.findExact(query);

    if (e) return e;

    e = this.findContains(query);

    if (e) return e;

    return this.findBest(query);
  }

  // ------------------------------------------------

  byRole(role) {
    role = role.toLowerCase();

    return this.elements.filter((e) => e.role === role);
  }

  buttons() {
    return this.byRole("button");
  }

  links() {
    return this.byRole("link");
  }

  textboxes() {
    return this.byRole("textbox");
  }

  checkboxes() {
    return this.byRole("checkbox");
  }

  comboboxes() {
    return this.byRole("combobox");
  }

  dump() {
    console.table(this.elements);
  }
}
