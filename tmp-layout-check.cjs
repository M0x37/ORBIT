const { _electron: electron } = require("@playwright/test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

(async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "orbit-layout-"));
  const app = await electron.launch({
    args: [__dirname],
    env: { ...process.env, ORBIT_E2E: "1", ORBIT_NO_ENV: "1", ORBIT_TEST_USER_DATA: userDataDir }
  });
  try {
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.locator("#sentry-configure-toggle").click();
    await page.evaluate(() => {
      document.querySelector("#sentry-clear").hidden = false;
      document.querySelector("#sentry-save").textContent = "Save";
    });
    const measure = async (label) => {
      const result = await page.evaluate(() => {
        const footer = document.querySelector(".sentry-form-footer");
        const save = document.querySelector("#sentry-save");
        const content = document.querySelector(".page-content");
        const windowBox = document.querySelector(".window");
        const saveBox = save.getBoundingClientRect();
        const contentBox = content.getBoundingClientRect();
        return {
          saveHeight: saveBox.height,
          saveVisible: saveBox.width > 0 && saveBox.height > 0,
          saveInsideContent: saveBox.right <= contentBox.right + 1,
          footerScrollWidth: footer.scrollWidth,
          footerClientWidth: footer.clientWidth,
          contentScrollHeight: content.scrollHeight,
          contentClientHeight: content.clientHeight,
          windowHeight: windowBox.getBoundingClientRect().height
        };
      });
      console.log(label, JSON.stringify(result));
    };

    await measure("980x560");
    const handle = await app.browserWindow(page);
    await handle.evaluate((window) => window.setSize(360, 560));
    await page.waitForFunction(() => window.innerWidth <= 420);
    await measure("360x560");
  } finally {
    await app.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
})();
