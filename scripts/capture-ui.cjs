const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const output = process.argv[2];
if (!output) throw new Error("Pass an absolute PNG output path");
const width = Number(process.argv[3] ?? 1440);
const height = Number(process.argv[4] ?? 920);
const targetView = process.argv[5];

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width,
    height,
    show: false,
    backgroundColor: "#eeeee8",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await window.loadFile(resolve("apps/desktop/dist/index.html"));
  await window.webContents.executeJavaScript("document.querySelector('.studio-view')?.style.setProperty('animation', 'none')");
  if (targetView) {
    await window.webContents.executeJavaScript(`
      [...document.querySelectorAll('.sidebar nav button')]
        .find((button) => button.textContent?.includes(${JSON.stringify(targetView)}))
        ?.click()
    `);
  }
  await new Promise((done) => setTimeout(done, 200));
  const image = await window.webContents.capturePage();
  writeFileSync(output, image.toPNG());
  window.destroy();
  app.quit();
});
