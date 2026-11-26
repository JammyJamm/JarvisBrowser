//==========================================================
//
// tests/test-interactive-agent.js
//
// End-to-End Test for Generic Interactive Agentic Flow:
// 1. Polite goal parsing ("can you buy iphone 18 in flipcart ?")
// 2. Self-healing blocking overlay dismissal
// 3. Multi-page Search -> Product Disambiguation pause
// 4. Variant (Model / Storage / Color) confusion permission pause
// 5. Delivery Address confirmation permission pause
// 6. Payment method & final order permission gate
//
//==========================================================

import assert from "assert";
import http from "http";
import { chromium } from "playwright";
import ExecutionEngine from "../backend/executor.js";
import browserController from "../backend/browser-controller.js";
import InteractiveAgent, { PLANNER_STATUS } from "../backend/interactive-agent.js";

function createMockStoreServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    if (url.pathname === "/") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Mock Shop Home</title></head>
          <body>
            <div role="dialog" style="position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:99;">
              <button aria-label="Close" onclick="this.parentElement.remove()">✕</button>
              <p>Login popup</p>
            </div>
            <form onsubmit="event.preventDefault(); location.href='/search?q=' + encodeURIComponent(document.getElementById('q').value)">
              <input id="q" name="q" type="search" placeholder="Search for products, brands and more" />
              <button type="submit">Search</button>
            </form>
          </body>
        </html>
      `);
      return;
    }

    if (url.pathname === "/search") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Search Results</title></head>
          <body>
            <h1>Results for ${url.searchParams.get("q") || ""}</h1>
            <div>
              <a href="/product?model=base">Apple iPhone 18 Base ₹79,900</a>
            </div>
            <div>
              <a href="/product?model=pro">Apple iPhone 18 Pro ₹1,19,900</a>
            </div>
          </body>
        </html>
      `);
      return;
    }

    if (url.pathname === "/product") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Apple iPhone 18</title></head>
          <body>
            <h1>Apple iPhone 18</h1>
            <div id="color-section">
              <div class="label">Color</div>
              <div class="options">
                <button type="button" onclick="this.classList.add('selected'); document.getElementById('chosenColor').innerText='Black'">Black</button>
                <button type="button" onclick="this.classList.add('selected'); document.getElementById('chosenColor').innerText='Blue'">Blue</button>
              </div>
            </div>
            <div id="storage-section">
              <span>Storage</span>
              <button type="button" onclick="this.classList.add('selected'); document.getElementById('chosenStorage').innerText='128 GB'">128 GB</button>
              <button type="button" onclick="this.classList.add('selected'); document.getElementById('chosenStorage').innerText='256 GB'">256 GB</button>
            </div>
            <div id="chosenColor"></div>
            <div id="chosenStorage"></div>
            <button type="button" onclick="location.href='/checkout-address'">Buy Now</button>
          </body>
        </html>
      `);
      return;
    }

    if (url.pathname === "/checkout-address") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Select Delivery Address</title></head>
          <body>
            <h2>Delivery Address</h2>
            <label><input type="radio" name="addr" /> Home - 42 MG Road, Bengaluru 560001</label>
            <label><input type="radio" name="addr" /> Office - Tech Park Phase 2, Bengaluru 560103</label>
            <button type="button" onclick="location.href='/checkout-payment'">Deliver Here</button>
          </body>
        </html>
      `);
      return;
    }

    if (url.pathname === "/checkout-payment") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Payment Options</title></head>
          <body>
            <h2>Payment Options</h2>
            <label><input type="radio" name="pay" /> UPI (GPay / PhonePe)</label>
            <label><input type="radio" name="pay" /> Credit / Debit Card</label>
            <label><input type="radio" name="pay" /> Cash on Delivery</label>
            <button type="button" onclick="document.body.innerHTML='<h1>Order Confirmed</h1><p>Order ID: ORD-987654</p>'">Place Order</button>
          </body>
        </html>
      `);
      return;
    }

    if (url.pathname === "/out-of-stock") {
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Apple iPhone 18 Unavailable</title></head>
          <body>
            <h1>Apple iPhone 18</h1>
            <p>Currently Unavailable — Out of Stock</p>
            <button type="button">Notify Me</button>
          </body>
        </html>
      `);
      return;
    }

    res.end("<h1>Not Found</h1>");
  });
}

async function runInteractiveAgentTests() {
  console.log("--- Starting InteractiveAgent E2E Tests ---");

  const server = createMockStoreServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    browserController.page = page;
    browserController.context = context;
    browserController.browser = browser;
    browserController.connected = true;

    const executor = new ExecutionEngine(browserController, null, { debug: false, maxRetries: 1 });
    const agent = new InteractiveAgent({
      browserController,
      executionEngine: executor,
      endpoint: "http://127.0.0.1:59999/unavailable", // force deterministic generic loop
      debug: false,
    });

    // Generic browser goals must select every step from the latest observed page.
    await page.setContent(`
      <button onclick="document.body.innerHTML = '<button onclick=&quot;document.body.innerText=\\'Goal reached\\'&quot;>Continue</button>'">Start</button>
    `);
    const originalDecision = agent.decideNextStepWithLLM;
    let observedDecisionCount = 0;
    agent.decideNextStepWithLLM = async (_session, obs) => {
      observedDecisionCount++;
      if (obs.bodyText.includes("Goal reached")) {
        return { decision: "done", summary: "Goal reached and verified." };
      }
      if (obs.actionButtons.includes("Continue")) {
        return {
          decision: "act",
          what: "Click the newly displayed Continue button",
          step: { tool: "click", args: { target: "Continue" } },
        };
      }
      return {
        decision: "act",
        what: "Click Start",
        step: { tool: "click", args: { target: "Start" } },
      };
    };
    const genericRes = await agent.startSession("click Start and continue until the goal is reached", { page });
    assert.strictEqual(genericRes.status, "completed");
    assert.strictEqual(genericRes.goalVerified, true);
    assert.strictEqual(observedDecisionCount, 3, "The agent must inspect the page before each action and verify completion");
    assert.deepStrictEqual(genericRes.steps.map((step) => step.args.target), ["Start", "Continue"]);
    agent.decideNextStepWithLLM = originalDecision;
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // 1. Goal parsing check for user's exact command & compound / mid-site variants
    const parsed = agent.parseGoal("can you buy iphone 18 in flipcart ?");
    assert.strictEqual(parsed.action, "buy");
    assert.strictEqual(parsed.item.toLowerCase(), "iphone 18");
    assert.strictEqual(parsed.targetUrl, "https://www.flipkart.com");
    assert.strictEqual(parsed.isPurchaseFlow, true);

    const parsedCompound = agent.parseGoal("open flipkart and buy iphone 18");
    assert.strictEqual(parsedCompound.action, "buy");
    assert.strictEqual(parsedCompound.item.toLowerCase(), "iphone 18");
    assert.strictEqual(parsedCompound.targetUrl, "https://www.flipkart.com");

    const parsedMidSite = agent.parseGoal("buy iphone 18 in flipkart 256gb blue");
    assert.strictEqual(parsedMidSite.targetUrl, "https://www.flipkart.com");
    assert.strictEqual(parsedMidSite.specifiedAttributes.storage, "256 GB");
    assert.strictEqual(parsedMidSite.specifiedAttributes.color, "blue");
    console.log("Test 1: Goal parsing for 'can you buy iphone 18 in flipcart ?' + compound/mid-site PASSED");

    // 2. Run interactive flow on mock store already loaded at baseUrl
    const startRes = await agent.startSession("can you buy iphone 18", { page });
    assert.strictEqual(startRes.status, "needs_input");
    assert.strictEqual(startRes.agent, "svgJarvis");
    assert.strictEqual(startRes.plan.blueprint.length, 0, "Should not use static predefined blueprint");
    assert.strictEqual(startRes.pendingPrompt.category, "product_selection");
    assert(startRes.pendingPrompt.options.length >= 2, "Should present multiple matching models");
    assert(
      startRes.steps.every((s) => s.status === PLANNER_STATUS.COMPLETED && Boolean(s.evidence)),
      "All completed steps must have COMPLETED status and browser verification evidence",
    );
    console.log("Test 2: Overlay self-healed + searched + paused for product_selection PASSED");

    // 3. Pick a product -> should reach product page and pause for Color selection
    const prodRes = await agent.respondToSession(startRes.sessionId, {
      choice: startRes.pendingPrompt.options[0].value,
    });
    assert.strictEqual(prodRes.status, "needs_input");
    assert.strictEqual(prodRes.pendingPrompt.category, "color_selection");
    console.log("Test 3: Product opened + paused for color_selection PASSED");

    // 4. Pick Color -> should pause for Storage selection
    const colorRes = await agent.respondToSession(startRes.sessionId, {
      choice: "Blue",
    });
    assert.strictEqual(colorRes.status, "needs_input");
    assert.strictEqual(colorRes.pendingPrompt.category, "storage_selection");
    console.log("Test 4: Color selected + paused for storage_selection PASSED");

    // 5. Pick Storage -> agent clicks Buy Now -> should pause for Delivery Address confirmation
    const addrRes = await agent.respondToSession(startRes.sessionId, {
      choice: "256 GB",
    });
    assert.strictEqual(addrRes.status, "needs_input");
    assert.strictEqual(addrRes.pendingPrompt.category, "address_confirmation");
    assert.strictEqual(addrRes.pendingPrompt.requiresPermission, true);
    console.log("Test 5: Storage selected + Buy Now clicked + paused for address_confirmation PASSED");

    // 6. Confirm Address -> agent clicks Deliver Here -> should pause for Payment method selection
    const payRes = await agent.respondToSession(startRes.sessionId, {
      choice: addrRes.pendingPrompt.options[0].value,
    });
    assert.strictEqual(payRes.status, "needs_input");
    assert.strictEqual(payRes.pendingPrompt.category, "payment_permission");
    assert.strictEqual(payRes.pendingPrompt.requiresPermission, true);
    console.log("Test 6: Address confirmed + paused for payment_permission PASSED");

    // 7. Selecting a payment method selects it WITHOUT authorizing payment; must pause for payment_authorization
    const authGateRes = await agent.respondToSession(startRes.sessionId, {
      choice: "UPI (GPay / PhonePe)",
    });
    assert.strictEqual(authGateRes.status, "needs_input");
    assert.strictEqual(authGateRes.pendingPrompt.category, "payment_authorization");
    assert.strictEqual(authGateRes.goalVerified, false);
    const placedBeforeAuth = await page.evaluate(() => document.body.innerText.includes("Order Confirmed"));
    assert.strictEqual(placedBeforeAuth, false, "Must NEVER place order without explicit payment authorization");
    console.log("Test 7: Selecting payment method paused for explicit payment_authorization PASSED");

    // 8. Manual takeover at payment pauses cleanly WITHOUT falsely reporting COMPLETED
    const manualRes = await agent.respondToSession(startRes.sessionId, {
      choice: "__manual_takeover__",
    });
    assert.strictEqual(manualRes.status, "waiting_for_user");
    assert.strictEqual(manualRes.goalVerified, false);
    assert.strictEqual(manualRes.plannerStatus, PLANNER_STATUS.WAITING_FOR_USER);
    assert(manualRes.completionReport.completedSteps.length > 0, "Report must list completed steps");
    assert(Boolean(manualRes.completionReport.reasonForWaiting), "Report must explain reason for waiting");
    assert(Boolean(manualRes.completionReport.exactActionRequired), "Report must state required user action");
    console.log("Test 8: Manual takeover reported WAITING_FOR_USER cleanly without false completion PASSED");

    // 9. Explicit payment authorization places order and verifies Order ID before COMPLETED
    await page.goto(`${baseUrl}/checkout-payment`, { waitUntil: "domcontentloaded" });
    const payPageSession = await agent.startSession("buy iphone 18", { page });
    assert.strictEqual(payPageSession.pendingPrompt.category, "payment_permission");
    const authRes = await agent.respondToSession(payPageSession.sessionId, { choice: "UPI (GPay / PhonePe)" });
    assert.strictEqual(authRes.pendingPrompt.category, "payment_authorization");
    const completedRes = await agent.respondToSession(payPageSession.sessionId, { choice: "__authorize_payment__" });
    assert.strictEqual(completedRes.status, "completed");
    assert.strictEqual(completedRes.goalVerified, true);
    assert.strictEqual(completedRes.plannerStatus, PLANNER_STATUS.COMPLETED);
    assert.match(completedRes.summary, /ORD-987654/);
    console.log("Test 9: Authorized payment placed order & verified Order ID before COMPLETED PASSED");

    // 10. Unexpected browser state (out-of-stock product) pauses with product_unavailable
    await page.goto(`${baseUrl}/out-of-stock`, { waitUntil: "domcontentloaded" });
    const oosRes = await agent.startSession("buy iphone 18", { page });
    assert.strictEqual(oosRes.status, "needs_input");
    assert.strictEqual(oosRes.pendingPrompt.category, "product_unavailable");
    console.log("Test 10: Out-of-stock state paused with product_unavailable PASSED");

    console.log("=== All InteractiveAgent E2E Tests Passed Successfully ===");
  } finally {
    await browser.close();
    server.close();
  }
}

runInteractiveAgentTests().catch((err) => {
  console.error("InteractiveAgent test failed:", err);
  process.exit(1);
});
