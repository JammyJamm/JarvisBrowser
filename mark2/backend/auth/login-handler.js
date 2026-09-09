// backend/auth/login-handler.js
// Specialized Autonomous Login Handler for E-Commerce, HR Portals, EdTech & Web Services
// Supports: Flipkart, ZingHR, Udemy, and Generic Universal Forms
// Includes: CAPTCHA / 2FA / OTP detection with Human-in-the-Loop escalation

import ProfileManager from "./profile-manager.js";

export class LoginHandler {
  constructor(options = {}) {
    this.options = {
      debug: options.debug ?? true,
      profileManager: options.profileManager || new ProfileManager(),
      ...options,
    };
  }

  log(...args) {
    if (this.options.debug) {
      console.log("[LoginHandler]", ...args);
    }
  }

  warn(...args) {
    console.warn("[LoginHandler]", ...args);
  }

  // ==========================================================
  // CHECK IF ALREADY LOGGED IN
  // ==========================================================

  async isLoggedIn(page, domain = "") {
    if (!page) return false;
    const cleanDomain = String(domain).toLowerCase();

    try {
      return await page.evaluate((d) => {
        const bodyText = document.body?.innerText || "";
        const html = document.documentElement?.innerHTML || "";

        // 1. Flipkart
        if (d.includes("flipkart")) {
          // If "My Account" or user profile dropdown is visible
          if (
            bodyText.includes("My Account") ||
            document.querySelector("div[class*='_1ruvv2'], a[href*='/account'], div[class*='_3N4_BI']")
          ) {
            return true;
          }
          return false;
        }

        // 2. ZingHR
        if (d.includes("zinghr")) {
          // If dashboard / employee portal is visible and not on login page
          const url = window.location.href.toLowerCase();
          if (url.includes("login") || url.includes("authenticate")) return false;
          if (
            bodyText.includes("Sign Out") ||
            bodyText.includes("Logout") ||
            document.querySelector("#ctl00_lblEmpName, .user-name, a[href*='logout']")
          ) {
            return true;
          }
          return false;
        }

        // 3. Udemy
        if (d.includes("udemy")) {
          if (
            bodyText.includes("My learning") ||
            document.querySelector("a[href*='/home/my-courses'], button[data-purpose='user-dropdown']")
          ) {
            return true;
          }
          return false;
        }

        // 4. Generic Check
        const loggedInKeywords = ["sign out", "log out", "my account", "dashboard", "profile", "welcome,"];
        const hasLogout = Array.from(document.querySelectorAll("a, button, span")).some((el) => {
          const txt = (el.innerText || "").trim().toLowerCase();
          return loggedInKeywords.some((kw) => txt.includes(kw));
        });

        return hasLogout;
      }, cleanDomain);
    } catch (err) {
      this.warn("isLoggedIn check error:", err.message);
      return false;
    }
  }

  // ==========================================================
  // MAIN LOGIN EXECUTION
  // ==========================================================

  async login(page, domain, credentials) {
    if (!page) {
      return { success: false, reason: "Browser page unavailable" };
    }

    if (!credentials || !credentials.username) {
      return {
        success: false,
        requiresCredentials: true,
        reason: `No credentials configured for domain "${domain}"`,
      };
    }

    const cleanDomain = String(domain).toLowerCase();
    this.log(`Initiating login sequence for "${cleanDomain}" using account "${credentials.username}"...`);

    // 1. Check if already logged in
    const alreadyIn = await this.isLoggedIn(page, cleanDomain);
    if (alreadyIn) {
      this.log(`Already authenticated on "${cleanDomain}". Skipping login form.`);
      return { success: true, alreadyLoggedIn: true };
    }

    // 2. Route to specialized domain login handler
    if (cleanDomain.includes("flipkart")) {
      return await this.loginFlipkart(page, credentials);
    }

    if (cleanDomain.includes("zinghr")) {
      return await this.loginZingHR(page, credentials);
    }

    if (cleanDomain.includes("udemy")) {
      return await this.loginUdemy(page, credentials);
    }

    // 3. Universal fallback login handler
    return await this.loginGeneric(page, credentials);
  }

  // ==========================================================
  // 🛍️ 1. FLIPKART LOGIN HANDLER
  // ==========================================================

  async loginFlipkart(page, credentials) {
    this.log("Executing Flipkart login routine...");
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes("flipkart.com")) {
        await page.goto("https://www.flipkart.com", { waitUntil: "domcontentloaded", timeout: 20000 });
      }

      // Check for login modal or login button
      const hasModalInput = await page.$("input[class*='r4vIwl'], input._2IX_2-").catch(() => null);

      if (!hasModalInput) {
        // Try clicking Login header button if not open
        const loginBtn = await page.$("a[href*='/account/login'], span:has-text('Login'), button:has-text('Login')").catch(() => null);
        if (loginBtn) {
          await loginBtn.click().catch(() => {});
          await page.waitForTimeout(1000).catch(() => {});
        } else {
          // Navigate directly to login page
          await page.goto("https://www.flipkart.com/account/login", { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
        }
      }

      await page.waitForTimeout(1000).catch(() => {});

      // 1. Fill phone/email input
      const usernameSelectors = [
        "input[class*='r4vIwl']",
        "input._2IX_2-",
        "input[type='text'][autocomplete='off']",
        "input[type='text']",
      ];

      let userInput = null;
      for (const sel of usernameSelectors) {
        userInput = await page.$(sel).catch(() => null);
        if (userInput) break;
      }

      if (!userInput) {
        return {
          success: false,
          requiresUserCheck: true,
          reason: "Unable to locate Flipkart login username / phone field. Please check the page.",
        };
      }

      await userInput.click().catch(() => {});
      await userInput.fill(credentials.username).catch(() => {});
      await page.waitForTimeout(500).catch(() => {});

      // Check if password field is immediately available or if "Request OTP" is shown
      const passwordInput = await page.$("input[type='password']").catch(() => null);

      if (passwordInput && credentials.password) {
        await passwordInput.click().catch(() => {});
        await passwordInput.fill(credentials.password).catch(() => {});
        await page.waitForTimeout(500).catch(() => {});

        // Submit form
        const submitBtn = await page.$("button[type='submit'], button._2KpZ6l._2HKlqd, button:has-text('Login')").catch(() => null);
        if (submitBtn) {
          await submitBtn.click().catch(() => {});
        } else {
          await page.keyboard.press("Enter").catch(() => {});
        }
      } else {
        // Click Continue or Request OTP
        const continueBtn = await page.$("button._2KpZ6l._2HKlqd, button:has-text('Request OTP'), button:has-text('CONTINUE')").catch(() => null);
        if (continueBtn) {
          await continueBtn.click().catch(() => {});
        } else {
          await page.keyboard.press("Enter").catch(() => {});
        }

        await page.waitForTimeout(1500).catch(() => {});

        // Flipkart now requires OTP / 2FA verification from user's device
        return {
          success: false,
          requiresUserCheck: true,
          checkType: "otp_verification",
          reason: "Flipkart requires OTP verification sent to your mobile/email. Please enter the OTP in the browser view, then click 'Continue'.",
        };
      }

      await page.waitForTimeout(2000).catch(() => {});

      // Verify login success or error
      const isSuccess = await this.isLoggedIn(page, "flipkart");
      if (isSuccess) {
        this.log("Flipkart login successful!");
        await this.persistSession(page, "flipkart.com");
        return { success: true, site: "flipkart.com" };
      }

      // Check if OTP was demanded post-submit
      const otpField = await page.$("input[class*='_2IX_2-'][maxlength='6'], input[placeholder*='OTP' i]").catch(() => null);
      if (otpField) {
        return {
          success: false,
          requiresUserCheck: true,
          checkType: "otp_verification",
          reason: "Flipkart requested an OTP verification code. Please enter the OTP in the browser view, then click 'I Solved It / Continue'.",
        };
      }

      return {
        success: false,
        requiresUserCheck: true,
        checkType: "credential_or_captcha",
        reason: "Flipkart login form submitted. Please verify login status or complete any CAPTCHA in the browser view.",
      };
    } catch (err) {
      this.warn("Flipkart login routine error:", err.message);
      return {
        success: false,
        requiresUserCheck: true,
        reason: `Flipkart login error: ${err.message}. Please complete login manually or verify page.`,
      };
    }
  }

  // ==========================================================
  // 🏢 2. ZINGHR LOGIN HANDLER
  // ==========================================================

  async loginZingHR(page, credentials) {
    this.log("Executing ZingHR login routine...");
    try {
      const companyCode = credentials.extraFields?.companyCode || credentials.companyCode || "";
      const currentUrl = page.url();

      if (!currentUrl.includes("zinghr.com")) {
        const targetUrl = companyCode
          ? `https://${companyCode.toLowerCase()}.zinghr.com`
          : "https://enterprise.zinghr.com/2020/pages/authentication/login.aspx";
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
      }

      await page.waitForTimeout(1200).catch(() => {});

      // 1. Fill Company Code if field is present
      const companyCodeInput = await page.$(
        "#txtCompanyCode, input[name*='CompanyCode' i], input[placeholder*='Company' i]"
      ).catch(() => null);

      if (companyCodeInput && companyCode) {
        await companyCodeInput.click().catch(() => {});
        await companyCodeInput.fill(companyCode).catch(() => {});
        await page.waitForTimeout(300).catch(() => {});
      }

      // 2. Fill Employee ID / Username
      const empCodeInput = await page.$(
        "#txtEmpCode, #txtUserName, input[name*='UserName' i], input[placeholder*='Employee' i], input[name*='EmpCode' i], input[type='text']"
      ).catch(() => null);

      if (empCodeInput) {
        await empCodeInput.click().catch(() => {});
        await empCodeInput.fill(credentials.username).catch(() => {});
        await page.waitForTimeout(300).catch(() => {});
      } else {
        return {
          success: false,
          requiresUserCheck: true,
          reason: "Unable to find ZingHR Employee ID / Username input field.",
        };
      }

      // 3. Fill Password
      const passwordInput = await page.$(
        "#txtPassword, input[name*='Password' i], input[type='password']"
      ).catch(() => null);

      if (passwordInput && credentials.password) {
        await passwordInput.click().catch(() => {});
        await passwordInput.fill(credentials.password).catch(() => {});
        await page.waitForTimeout(300).catch(() => {});
      } else if (!credentials.password) {
        return {
          success: false,
          requiresCredentials: true,
          reason: "ZingHR password missing from credential store.",
        };
      }

      // 4. Click Sign In Button
      const submitBtn = await page.$(
        "#btnSignIn, input#btnSignIn, button[type='submit'], button:has-text('Sign In'), button:has-text('Log In')"
      ).catch(() => null);

      if (submitBtn) {
        await submitBtn.click().catch(() => {});
      } else {
        await page.keyboard.press("Enter").catch(() => {});
      }

      await page.waitForTimeout(2500).catch(() => {});

      // Check for login errors on ZingHR page
      const errorMsg = await page.evaluate(() => {
        const errEl = document.querySelector("#lblError, .error-message, .alert-danger, span[style*='red']");
        return errEl ? errEl.innerText.trim() : null;
      }).catch(() => null);

      if (errorMsg) {
        return {
          success: false,
          requiresUserCheck: true,
          checkType: "auth_failure",
          reason: `ZingHR reported an authentication error: "${errorMsg}". Please verify credentials.`,
        };
      }

      const success = await this.isLoggedIn(page, "zinghr");
      if (success) {
        this.log("ZingHR login successful!");
        await this.persistSession(page, "zinghr.com");
        return { success: true, site: "zinghr.com" };
      }

      return {
        success: false,
        requiresUserCheck: true,
        checkType: "zinghr_verification",
        reason: "ZingHR login submitted. Please verify login status, complete any 2FA/Security questions, and click Continue.",
      };
    } catch (err) {
      this.warn("ZingHR login error:", err.message);
      return {
        success: false,
        requiresUserCheck: true,
        reason: `ZingHR login error: ${err.message}. Please complete manually or check page.`,
      };
    }
  }

  // ==========================================================
  // 🎓 3. UDEMY LOGIN HANDLER
  // ==========================================================

  async loginUdemy(page, credentials) {
    this.log("Executing Udemy login routine...");
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes("udemy.com")) {
        await page.goto("https://www.udemy.com/join/login-popup/", { waitUntil: "domcontentloaded", timeout: 25000 });
      } else if (!currentUrl.includes("/login")) {
        // Find Log in button
        const loginBtn = await page.$("a[data-purpose='header-login'], a:has-text('Log in'), button:has-text('Log in')").catch(() => null);
        if (loginBtn) {
          await loginBtn.click().catch(() => {});
          await page.waitForTimeout(1500).catch(() => {});
        } else {
          await page.goto("https://www.udemy.com/join/login-popup/", { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
        }
      }

      await page.waitForTimeout(1000).catch(() => {});

      // 1. Fill Email
      const emailInput = await page.$("input[name='email'], input[type='email'], input[id*='email' i]").catch(() => null);
      if (!emailInput) {
        return {
          success: false,
          requiresUserCheck: true,
          reason: "Unable to find Udemy email field. Check if Cloudflare or bot protection was triggered.",
        };
      }

      await emailInput.click().catch(() => {});
      await emailInput.fill(credentials.username).catch(() => {});
      await page.waitForTimeout(400).catch(() => {});

      // 2. Fill Password
      const passwordInput = await page.$("input[name='password'], input[type='password']").catch(() => null);
      if (passwordInput && credentials.password) {
        await passwordInput.click().catch(() => {});
        await passwordInput.fill(credentials.password).catch(() => {});
        await page.waitForTimeout(400).catch(() => {});
      }

      // 3. Click Submit
      const submitBtn = await page.$(
        "button[data-purpose='submit'], button[type='submit'], button:has-text('Log in')"
      ).catch(() => null);

      if (submitBtn) {
        await submitBtn.click().catch(() => {});
      } else {
        await page.keyboard.press("Enter").catch(() => {});
      }

      await page.waitForTimeout(2500).catch(() => {});

      // Check if Captcha / Cloudflare appeared
      const hasCaptcha = await page.evaluate(() => {
        return Boolean(
          document.querySelector("iframe[src*='recaptcha'], iframe[src*='cloudflare'], div.cf-turnstile, #turnstile-wrapper")
        );
      }).catch(() => false);

      if (hasCaptcha) {
        return {
          success: false,
          requiresUserCheck: true,
          checkType: "captcha_verification",
          reason: "Udemy presented a CAPTCHA / Cloudflare Turnstile security check. Please solve it in the browser view, then click Continue.",
        };
      }

      const success = await this.isLoggedIn(page, "udemy");
      if (success) {
        this.log("Udemy login successful!");
        await this.persistSession(page, "udemy.com");
        return { success: true, site: "udemy.com" };
      }

      return {
        success: false,
        requiresUserCheck: true,
        checkType: "udemy_auth_check",
        reason: "Udemy login credentials submitted. Please verify login in browser and click Continue.",
      };
    } catch (err) {
      this.warn("Udemy login routine error:", err.message);
      return {
        success: false,
        requiresUserCheck: true,
        reason: `Udemy login error: ${err.message}`,
      };
    }
  }

  // ==========================================================
  // 🌐 4. GENERIC UNIVERSAL LOGIN HANDLER
  // ==========================================================

  async loginGeneric(page, credentials) {
    this.log("Executing generic form login routine...");
    try {
      await page.waitForTimeout(800).catch(() => {});

      const filled = await page.evaluate((creds) => {
        // Find username / email
        const userSelectors = [
          "input[type='email']",
          "input[name*='email' i]",
          "input[name*='user' i]",
          "input[id*='user' i]",
          "input[id*='email' i]",
          "input[autocomplete*='username' i]",
          "input[placeholder*='email' i]",
          "input[placeholder*='username' i]",
          "input[type='text']",
        ];

        let userEl = null;
        for (const sel of userSelectors) {
          const els = Array.from(document.querySelectorAll(sel)).filter((e) => e.offsetParent !== null);
          if (els.length > 0) {
            userEl = els[0];
            break;
          }
        }

        if (userEl) {
          userEl.focus();
          userEl.value = creds.username;
          userEl.dispatchEvent(new Event("input", { bubbles: true }));
          userEl.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Find password
        const passEl = document.querySelector("input[type='password']");
        if (passEl && creds.password) {
          passEl.focus();
          passEl.value = creds.password;
          passEl.dispatchEvent(new Event("input", { bubbles: true }));
          passEl.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Find submit
        const submitBtn = document.querySelector(
          "button[type='submit'], input[type='submit'], button:has-text('Sign in'), button:has-text('Log in')"
        );

        if (submitBtn) {
          submitBtn.click();
          return true;
        }

        return Boolean(userEl && passEl);
      }, credentials).catch(() => false);

      if (!filled) {
        return {
          success: false,
          requiresUserCheck: true,
          reason: "Unable to detect generic login fields automatically. Please complete login in the browser view.",
        };
      }

      await page.waitForTimeout(2000).catch(() => {});

      return {
        success: true,
        generic: true,
        message: "Credentials submitted into detected login form.",
      };
    } catch (err) {
      this.warn("Generic login error:", err.message);
      return {
        success: false,
        requiresUserCheck: true,
        reason: `Generic login error: ${err.message}`,
      };
    }
  }

  // ==========================================================
  // PERSIST STORAGE STATE VIA PROFILE MANAGER
  // ==========================================================

  async persistSession(page, domain) {
    try {
      if (this.options.profileManager && page.context) {
        await this.options.profileManager.save(domain, page.context());
        this.log(`Persisted session storageState for "${domain}"`);
      }
    } catch (e) {
      this.warn("Failed to persist session profile:", e.message);
    }
  }
}

export const loginHandler = new LoginHandler();
export default loginHandler;