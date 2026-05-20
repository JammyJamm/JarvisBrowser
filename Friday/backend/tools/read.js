module.exports = async ({ page }, { title }) => {
  const content = await page.evaluate((title) => {
    const txt = document.body.innerText;

    if (!title || title.trim() === "") {
      // Return structured HTML for full page
      return {
        html: document.body.innerHTML.slice(0, 5000),
        text: txt.slice(0, 3000),
      };
    }

    const i = txt.toLowerCase().indexOf(title.toLowerCase());

    if (i === -1) {
      return {
        text: "Not found",
        html: "",
      };
    }

    const startText = txt.slice(i, i + 1500);

    // Find nearby HTML elements
    const elements = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      const nodeText = node.innerText || "";
      if (
        nodeText.toLowerCase().includes(title.toLowerCase()) &&
        elements.length < 5
      ) {
        elements.push({
          tag: node.tagName.toLowerCase(),
          text: nodeText.slice(0, 300),
          html: node.outerHTML.slice(0, 500),
        });
      }
    }

    return {
      text: startText,
      html: elements.length > 0 ? elements : startText,
    };
  }, title);

  return {
    url: page.url(),
    content,
  };
};
