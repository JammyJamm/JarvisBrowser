module.exports = async ({ page }, { title }) => {
  const content = await page.evaluate((title) => {
    const txt = document.body.innerText;

    const i = txt.toLowerCase().indexOf(title.toLowerCase());

    if (i === -1) return "Not found";

    return txt.slice(i, i + 1500);
  }, title);

  return {
    url: page.url(),
    content,
  };
};
