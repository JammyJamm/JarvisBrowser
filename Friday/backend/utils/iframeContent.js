export async function clickInsideEvolutionFrame(page, targetText) {
  console.log("======================================");
  console.log("Evolution iframe helper");
  console.log("======================================");

  try {
    //----------------------------------------------------
    // Wait briefly for iframe
    //----------------------------------------------------

    await page
      .waitForSelector("iframe", {
        timeout: 2000,
      })
      .catch(() => {});

    //----------------------------------------------------
    // Get all frames
    //----------------------------------------------------

    const frames = page.frames();

    console.log(`Frames found: ${frames.length}`);

    frames.forEach((frame, i) => {
      console.log(`[${i}] ${frame.url()}`);
    });

    //----------------------------------------------------
    // Find ALL Evolution frames
    //----------------------------------------------------

    const evoFrames = frames.filter((frame) => {
      const url = (frame.url() || "").toLowerCase();

      return url.includes("frontend/evo") || url.includes("lifkzibqgat.click");
    });

    if (!evoFrames.length) {
      console.log("No Evolution iframe found.");
      return false;
    }

    console.log(`Evolution frames: ${evoFrames.length}`);

    //----------------------------------------------------
    // Search every Evolution frame
    //----------------------------------------------------

    for (const frame of evoFrames) {
      console.log("--------------------------------");
      console.log("Searching:");
      console.log(frame.url());

      await frame.waitForLoadState("domcontentloaded").catch(() => {});

      //--------------------------------------------------
      // Debug
      //--------------------------------------------------

      try {
        const html = await frame.locator("body").innerHTML();

        console.log("HTML Preview:");
        console.log(html.substring(0, 2000));
      } catch {}

      //--------------------------------------------------
      // Strategy 1
      //--------------------------------------------------

      try {
        const locator = frame.getByText(targetText, {
          exact: false,
        });

        if (
          await locator
            .first()
            .isVisible({ timeout: 1000 })
            .catch(() => false)
        ) {
          await locator
            .first()
            .scrollIntoViewIfNeeded()
            .catch(() => {});

          await locator.first().click({
            force: true,
          });

          console.log("Clicked using getByText");

          return true;
        }
      } catch {}

      //--------------------------------------------------
      // Strategy 2
      //--------------------------------------------------

      try {
        const locator = frame.locator(`text=${targetText}`);

        if (await locator.count()) {
          await locator.first().click({
            force: true,
          });

          console.log("Clicked using text locator");

          return true;
        }
      } catch {}

      //--------------------------------------------------
      // Strategy 3
      //--------------------------------------------------

      try {
        const locator = frame.locator(`button:has-text("${targetText}")`);

        if (await locator.count()) {
          await locator.first().click({
            force: true,
          });

          console.log("Clicked using button");

          return true;
        }
      } catch {}

      //--------------------------------------------------
      // Strategy 4
      //--------------------------------------------------

      try {
        const locator = frame.getByRole("button", {
          name: new RegExp(targetText, "i"),
        });

        if (await locator.count()) {
          await locator.first().click({
            force: true,
          });

          console.log("Clicked using role");

          return true;
        }
      } catch {}

      //--------------------------------------------------
      // Strategy 5
      //--------------------------------------------------

      try {
        const locator = frame.locator(`[aria-label*="${targetText}" i]`);

        if (await locator.count()) {
          await locator.first().click({
            force: true,
          });

          console.log("Clicked using aria-label");

          return true;
        }
      } catch {}

      //--------------------------------------------------
      // Strategy 6 - dump clickable elements
      //--------------------------------------------------

      try {
        const items = await frame
          .locator("button,a,[role='button'],div,span")
          .evaluateAll((nodes) =>
            nodes
              .filter((n) => (n.textContent || "").trim())
              .map((n) => ({
                tag: n.tagName,
                text: (n.textContent || "").trim(),
                aria: n.getAttribute("aria-label"),
                cls: n.className,
              })),
          );

        console.log("Clickable elements:");
        console.log(items);
      } catch {}
    }

    console.log("Target not found inside Evolution iframe.");

    return false;
  } catch (err) {
    console.log("Evolution helper failed:");
    console.log(err.message);

    return false;
  }
}
