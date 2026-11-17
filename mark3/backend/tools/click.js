module.exports = async ({ page }, { text }) => {
  // Clean up search text
  const searchText = String(text)
    .replace(/^["']|["']$/g, "")
    .replace(/\(finds.*\)/i, "")
    .trim()
    .toLowerCase();

  // Wait for page to load
  await page.waitForTimeout(1500);

  // Strategy 1: Find by structural/class-based matching
  const found = await page.evaluate((query) => {
    // Look for any element that contains the search text
    const allElements = document.querySelectorAll("*");

    for (const el of allElements) {
      // Check direct text content (only immediate text)
      const directText = Array.from(el.childNodes)
        .filter(node => node.nodeType === 3) // Text nodes only
        .map(node => node.textContent.trim())
        .join(" ")
        .toLowerCase();

      // Also check if text is in immediate span/div children
      const immediateText = el.textContent?.toLowerCase() || "";

      if (
        directText.includes(query) ||
        immediateText.includes(query)
      ) {
        // Find clickable ancestor
        let clickable = el;

        // Walk up to find a clickable element
        while (clickable && clickable !== document.body) {
          if (
            clickable.tagName === "BUTTON" ||
            clickable.tagName === "A" ||
            clickable.tagName === "LABEL" ||
            (clickable.tagName === "INPUT" && clickable.type === "radio") ||
            clickable.tagName === "LI" ||
            (clickable.tagName === "DIV" && clickable.onclick) ||
            (clickable.tagName === "SPAN" && clickable.onclick) ||
            clickable.getAttribute("role") === "button" ||
            clickable.getAttribute("role") === "tab"
          ) {
            return {
              found: true,
              tag: clickable.tagName,
              text: clickable.textContent?.substring(0, 50),
            };
          }

          clickable = clickable.parentElement;
        }

        // If no clickable parent, return the element itself
        if (el.tagName === "SPAN" || el.tagName === "DIV") {
          return {
            found: true,
            tag: el.tagName,
            text: el.textContent?.substring(0, 50),
          };
        }
      }
    }

    return { found: false };
  }, searchText);

  if (!found.found) {
    throw new Error(`Element with text "${searchText}" not found on page`);
  }

  // Strategy 2: Click the found element
  await page.click(`*:has(span:contains("${searchText}"))`, { timeout: 2000 }).catch(async () => {
    // Fallback: Use locator to find and click
    const result = await page.evaluate((query) => {
      const allElements = document.querySelectorAll("*");

      for (const el of allElements) {
        const text = el.textContent?.toLowerCase() || "";

        if (text.includes(query)) {
          // Find clickable ancestor
          let clickable = el;
          while (clickable && clickable !== document.body) {
            if (
              clickable.tagName === "BUTTON" ||
              clickable.tagName === "A" ||
              clickable.tagName === "LABEL" ||
              (clickable.tagName === "INPUT" && clickable.type === "radio") ||
              clickable.getAttribute("role") === "button" ||
              clickable.getAttribute("role") === "tab"
            ) {
              clickable.click();
              return true;
            }
            clickable = clickable.parentElement;
          }
        }
      }
      return false;
    }, searchText);

    if (!result) {
      throw new Error(`Could not click element with text "${searchText}"`);
    }
  });

  return {
    url: page.url(),
  };
};
