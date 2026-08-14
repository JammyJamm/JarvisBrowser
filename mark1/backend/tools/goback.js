module.exports = async ({ page }, args) => {
  try {
    await page.goBack({
      waitUntil: "domcontentloaded",
    });

    return {
      url: page.url(),
      success: true,
      message: "Navigated back",
    };
  } catch (err) {
    return {
      url: page.url(),
      success: false,
      message: err.message,
    };
  }
};
