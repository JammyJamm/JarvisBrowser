module.exports = async ({ page }, { url }) => {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
  });

  return {
    url: page.url(),
  };
};
