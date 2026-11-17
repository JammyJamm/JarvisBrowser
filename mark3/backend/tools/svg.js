const { getSVGDataFromIframe, getAllSVGsFromFrames } = require("../utils/iframeContent.js");

module.exports = async ({ page }, options = {}) => {
  if (!page) {
    throw new Error("Page is required.");
  }

  if (options.onlyIframes !== false) {
    return await getSVGDataFromIframe(page, options);
  }

  const frames = await getAllSVGsFromFrames(page, options);
  return {
    success: true,
    totalFrames: frames.length,
    frames,
  };
};
