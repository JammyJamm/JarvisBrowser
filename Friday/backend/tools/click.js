module.exports = async ({ page }, { text }) => {
  const els = await page.$$("button,a,[role='button'],input[type='submit']");

  for (const el of els) {
    const t = (
      (await el.textContent()) ||
      (await el.getAttribute("value")) ||
      ""
    ).toLowerCase();

    if (t.includes(text.toLowerCase())) {
      await el.click();

      return {
        url: page.url(),
      };
    }
  }

  throw new Error("Button not found");
};
