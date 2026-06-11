// snapshot-parser.js

export default class SnapshotParser {
  constructor(snapshot) {
    this.raw = snapshot;
    this.text = this.extractText(snapshot);
    this.elements = this.parse();
  }

  // ----------------------------------------
  // Extract plain text from MCP response
  // ----------------------------------------

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

  // ----------------------------------------
  // Parse browser_snapshot output
  // ----------------------------------------

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

  // ----------------------------------------
  // Parse one snapshot line
  //
  // Example:
  //
  // button "Learn more" [ref=e42]
  // textbox "Search" [ref=e15]
  // link "About" [ref=e77]
  // checkbox "Remember me" [ref=e18]
  // ----------------------------------------

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
      searchable: (role + " " + name + " " + line).toLowerCase(),
    };
  }

  // ----------------------------------------
  // Return every parsed element
  // ----------------------------------------

  all() {
    return this.elements;
  }

  // ----------------------------------------
  // Find exact match
  // ----------------------------------------

  findExact(text) {
    text = text.toLowerCase();

    return this.elements.find((e) => e.name.toLowerCase() === text) || null;
  }

  // ----------------------------------------
  // Find contains
  // ----------------------------------------

  findContains(text) {
    text = text.toLowerCase();

    return this.elements.find((e) => e.searchable.includes(text)) || null;
  }

  // ----------------------------------------
  // Fuzzy search
  // ----------------------------------------

  score(str, query) {
    str = str.toLowerCase();
    query = query.toLowerCase();

    if (str === query) return 100;

    if (str.startsWith(query)) return 90;

    if (str.includes(query)) return 80;

    const words = query.split(" ");

    let score = 0;

    for (const w of words) {
      if (str.includes(w)) score += 10;
    }

    return score;
  }

  findBest(query) {
    let best = null;

    let bestScore = 0;

    for (const e of this.elements) {
      const s = this.score(e.searchable, query);

      if (s > bestScore) {
        best = e;
        bestScore = s;
      }
    }

    return best;
  }

  // ----------------------------------------
  // Get target only
  // ----------------------------------------

  getTarget(query) {
    let e = this.findExact(query);

    if (e) return e.target;

    e = this.findContains(query);

    if (e) return e.target;

    e = this.findBest(query);

    if (e) return e.target;

    return null;
  }

  // ----------------------------------------
  // Get element object
  // ----------------------------------------

  get(query) {
    let e = this.findExact(query);

    if (e) return e;

    e = this.findContains(query);

    if (e) return e;

    return this.findBest(query);
  }

  // ----------------------------------------
  // Filter by role
  // ----------------------------------------

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

  // ----------------------------------------
  // Pretty print
  // ----------------------------------------

  dump() {
    console.table(this.elements);
  }
}
