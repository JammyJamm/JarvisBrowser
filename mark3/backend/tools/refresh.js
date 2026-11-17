module.exports = async ({ page }, args) => {
  try {
    await page.reload({
      waitUntil: "domcontentloaded",
    });

    return {
      url: page.url(),
      success: true,
      message: "Page refreshed",
    };
  } catch (err) {
    return {
      url: page.url(),
      success: false,
      message: err.message,
    };
  }
};
