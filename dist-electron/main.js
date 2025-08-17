import { app as o, BrowserWindow as l, ipcMain as t, dialog as c } from "electron";
import { fileURLToPath as f } from "node:url";
import s from "node:path";
import d from "node:fs/promises";
const p = s.dirname(f(import.meta.url));
process.env.APP_ROOT = s.join(p, "..");
const a = process.env.VITE_DEV_SERVER_URL, v = s.join(process.env.APP_ROOT, "dist-electron"), m = s.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = a ? s.join(process.env.APP_ROOT, "public") : m;
let e;
function u() {
  e = new l({
    width: 1200,
    height: 800,
    icon: process.env.VITE_PUBLIC ? s.join(process.env.VITE_PUBLIC, "vite.svg") : void 0,
    webPreferences: {
      preload: s.join(p, "preload.mjs"),
      nodeIntegration: !1,
      contextIsolation: !0
    }
  }), e.webContents.on("did-finish-load", () => {
    e == null || e.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  }), a ? e.loadURL(a) : e.loadFile(s.join(m, "index.html"));
}
o.on("window-all-closed", () => {
  process.platform !== "darwin" && (o.quit(), e = null);
});
o.on("activate", () => {
  l.getAllWindows().length === 0 && u();
});
o.whenReady().then(u);
t.handle("read-file", async (r, i) => {
  try {
    return { success: !0, content: await d.readFile(i, "utf-8") };
  } catch (n) {
    return { success: !1, error: n.message };
  }
});
t.handle("write-file", async (r, i, n) => {
  try {
    return await d.writeFile(i, n, "utf-8"), { success: !0 };
  } catch (w) {
    return { success: !1, error: w.message };
  }
});
t.handle("show-open-dialog", async () => await c.showOpenDialog(e, {
  properties: ["openFile"],
  filters: [
    { name: "Asemic Files", extensions: ["asemic"] },
    { name: "All Files", extensions: ["*"] }
  ]
}));
t.handle("show-save-dialog", async () => await c.showSaveDialog(e, {
  filters: [
    { name: "Asemic Files", extensions: ["asemic"] },
    { name: "All Files", extensions: ["*"] }
  ]
}));
export {
  v as MAIN_DIST,
  m as RENDERER_DIST,
  a as VITE_DEV_SERVER_URL
};
