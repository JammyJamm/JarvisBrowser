module.exports = async ({ page }, args) => {
  try {
    await page.goForward({
      waitUntil: "domcontentloaded",
    });

    return {
      url: page.url(),
      success: true,
      message: "Navigated forward",
    };
  } catch (err) {
    return {
      url: page.url(),
      success: false,
      message: err.message,
    };
  }
};
