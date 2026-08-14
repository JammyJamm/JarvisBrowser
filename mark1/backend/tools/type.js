module.exports = async ({ page }, { field, value }) => {
  const els = await page.$$("input");

  for (const el of els) {
    const meta =
      ((await el.getAttribute("placeholder")) || "") +
      " " +
      ((await el.getAttribute("name")) || "") +
      " " +
      ((await el.getAttribute("type")) || "");

    if (meta.toLowerCase().includes(field.toLowerCase())) {
      await el.fill(value);

      return {
        url: page.url(),
      };
    }
  }

  throw new Error("Input not found");
};
