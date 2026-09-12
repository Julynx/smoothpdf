/**
 * @module pdf-resilience-test
 * Integration tests verifying PDF rendering resilience under rapid reloads and drastic page count shrinkage.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

describe("SmoothPDF Rendering Resilience", () => {
  it("handles rapid reloads and drastic document shrinkage without null destruction errors", async () => {
    const testRunnerScriptPath = path.join(
      os.tmpdir(),
      `smoothpdf-resilience-${Date.now()}.js`,
    );

    const scriptContent = `
      const { app, BrowserWindow, protocol, ipcMain } = require("electron");
      const path = require("path");
      const fs = require("fs");
      const { execSync } = require("child_process");

      const temporaryDirectory = fs.mkdtempSync(path.join(app.getPath("temp"), "test-smoothpdf-resilience-"));
      app.setPath("userData", path.join(temporaryDirectory, "user-data"));

      const largeMarkdownPath = path.join(temporaryDirectory, "large.md");
      const largePdfPath = path.join(temporaryDirectory, "large.pdf");
      const largeContent = Array.from({ length: 30 }, (_, index) => "## Section " + index + "\\n\\nContent for section " + index).join("\\n\\n");
      fs.writeFileSync(largeMarkdownPath, largeContent, "utf8");
      execSync(\`markdown-convert "\${largeMarkdownPath}" --mode=once --out="\${largePdfPath}"\`, { timeout: 15000 });

      const smallMarkdownPath = path.join(temporaryDirectory, "small.md");
      const smallPdfPath = path.join(temporaryDirectory, "small.pdf");
      const smallContent = "# Short Document\\n\\nA single short paragraph.";
      fs.writeFileSync(smallMarkdownPath, smallContent, "utf8");
      execSync(\`markdown-convert "\${smallMarkdownPath}" --mode=once --out="\${smallPdfPath}"\`, { timeout: 15000 });

      let currentWatchedPdf = largePdfPath;

      protocol.registerSchemesAsPrivileged([
        {
          scheme: "safe-file",
          privileges: {
            standard: false,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true,
          },
        },
      ]);

      app.whenReady().then(async () => {
        protocol.handle("safe-file", (request) => {
          try {
            const urlWithoutQuery = request.url.split("?")[0];
            const rawPath = urlWithoutQuery.slice("safe-file://".length);
            const decodedPath = decodeURIComponent(rawPath);
            const absoluteRequestedPath = path.resolve(decodedPath);
            if (!fs.existsSync(absoluteRequestedPath)) {
              return new Response("Not found", { status: 404 });
            }
            const fileData = fs.readFileSync(absoluteRequestedPath);
            return new Response(fileData, {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Length": String(fileData.length),
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache",
              },
            });
          } catch (protocolError) {
            return new Response("Error", { status: 500 });
          }
        });

        const windowInstance = new BrowserWindow({
          width: 1000,
          height: 800,
          show: false,
          webPreferences: {
            preload: path.join("${path.join(__dirname, "..", "preload.js").replace(/\\/g, "\\\\")}"),
            contextIsolation: true,
            nodeIntegration: false,
          },
        });

        ipcMain.handle("getFilePath", () => currentWatchedPdf);
        ipcMain.handle("closeFile", async () => true);

        const collectedConsoleErrors = [];
        windowInstance.webContents.on("console-message", (event, level, message) => {
          if (
            level >= 3 ||
            (message &&
              (message.includes("sendWithPromise") ||
                message.includes("Cannot read properties of null")))
          ) {
            collectedConsoleErrors.push(message);
          }
        });

        windowInstance.loadFile(path.join("${path.join(__dirname, "..", "index.html").replace(/\\/g, "\\\\")}"));

        windowInstance.webContents.on("did-finish-load", async () => {
          try {
            const initialResult = await windowInstance.webContents.executeJavaScript(\`
              new Promise((resolve) => {
                const check = async () => {
                  const { state } = await import("./js/state.js");
                  const { jumpToPage } = await import("./js/pdf.js");
                  if (state.currentPdfDocument && !state.isRendering) {
                    jumpToPage(state.totalPages);
                    resolve({
                      initialLargeTotalPages: state.totalPages,
                      pageBeforeShrink: state.currentPageNumber,
                    });
                  } else {
                    setTimeout(check, 50);
                  }
                };
                check();
              });
            \`);

            await new Promise((resolve) => setTimeout(resolve, 200));

            currentWatchedPdf = smallPdfPath;
            windowInstance.webContents.send("fileUpdated", largePdfPath);
            windowInstance.webContents.send("fileUpdated", smallPdfPath);
            windowInstance.webContents.send("fileUpdated", largePdfPath);
            windowInstance.webContents.send("fileUpdated", smallPdfPath);

            const smallResult = await windowInstance.webContents.executeJavaScript(\`
              new Promise((resolve) => {
                const check = async () => {
                  const { state } = await import("./js/state.js");
                  if (!state.isRendering && !state.pendingRenderOptions) {
                    resolve({
                      smallTotalPages: state.totalPages,
                      pageAfterShrink: state.currentPageNumber,
                      frontContainerCount: state.currentFront ? state.currentFront.querySelectorAll(".page-container").length : 0,
                      frontHasCanvas: state.currentFront ? !!state.currentFront.querySelector("canvas") : false,
                    });
                  } else {
                    setTimeout(check, 50);
                  }
                };
                setTimeout(check, 100);
              });
            \`);

            currentWatchedPdf = largePdfPath;
            windowInstance.webContents.send("fileUpdated", largePdfPath);

            const recoveredResult = await windowInstance.webContents.executeJavaScript(\`
              new Promise((resolve) => {
                const check = async () => {
                  const { state } = await import("./js/state.js");
                  if (!state.isRendering && !state.pendingRenderOptions && state.totalPages > 1) {
                    resolve({
                      recoveredTotalPages: state.totalPages,
                      recoveredCanvasCount: state.currentFront ? state.currentFront.querySelectorAll("canvas").length : 0,
                    });
                  } else {
                    setTimeout(check, 50);
                  }
                };
                setTimeout(check, 100);
              });
            \`);

            const hasNullPropertyError = collectedConsoleErrors.some((errorText) =>
              errorText.includes("sendWithPromise") || errorText.includes("Cannot read properties of null")
            );

            const combinedPayload = {
              ok: true,
              ...initialResult,
              ...smallResult,
              ...recoveredResult,
              hasNullPropertyError,
              errorCount: collectedConsoleErrors.length,
              errors: collectedConsoleErrors,
            };

            console.log(JSON.stringify(combinedPayload));

            const testsPassed =
              combinedPayload.initialLargeTotalPages >= 2 &&
              combinedPayload.smallTotalPages === 1 &&
              combinedPayload.pageAfterShrink === 1 &&
              combinedPayload.frontContainerCount === 1 &&
              combinedPayload.frontHasCanvas &&
              combinedPayload.recoveredTotalPages === combinedPayload.initialLargeTotalPages &&
              combinedPayload.recoveredCanvasCount > 0 &&
              !hasNullPropertyError;

            app.exit(testsPassed ? 0 : 1);
          } catch (executionError) {
            console.error(executionError);
            app.exit(1);
          }
        });
      });
    `;

    fs.writeFileSync(testRunnerScriptPath, scriptContent, "utf8");

    const electronExecutable = require("electron");

    await new Promise((resolve, reject) => {
      const childProcess = spawn(electronExecutable, [testRunnerScriptPath], {
        windowsHide: true,
      });

      let standardOutput = "";
      let standardError = "";

      childProcess.stdout.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        standardOutput += text;
        process.stdout.write(text);
      });

      childProcess.stderr.on("data", (chunk) => {
        const text = chunk.toString("utf8");
        standardError += text;
        process.stderr.write(text);
      });

      childProcess.on("close", (exitCode) => {
        try {
          fs.rmSync(testRunnerScriptPath, { force: true });
        } catch (cleanupError) {
          console.error("Cleanup error:", cleanupError);
        }

        if (exitCode === 0) {
          const matchedResult = standardOutput.match(/\{.*"ok":true.*\}/);
          assert.ok(matchedResult, "Test output must contain success payload");
          const parsedResult = JSON.parse(matchedResult[0]);

          assert.ok(
            parsedResult.initialLargeTotalPages >= 2,
            "Large document must contain multiple pages",
          );
          assert.strictEqual(
            parsedResult.smallTotalPages,
            1,
            "Small document must contain exactly one page",
          );
          assert.strictEqual(
            parsedResult.pageAfterShrink,
            1,
            "Current page must be clamped to page 1 after drastic shrinkage",
          );
          assert.strictEqual(
            parsedResult.frontContainerCount,
            1,
            "Front layer must contain single page container",
          );
          assert.ok(
            parsedResult.frontHasCanvas,
            "Front layer must render canvas for page 1",
          );
          assert.strictEqual(
            parsedResult.recoveredTotalPages,
            parsedResult.initialLargeTotalPages,
            "Subsequent reload must restore full page count",
          );
          assert.ok(
            !parsedResult.hasNullPropertyError,
            "No null proxy sendWithPromise errors allowed during rapid reloads",
          );
          resolve();
        } else {
          reject(
            new Error(
              `Resilience test failed with code ${exitCode}\nSTDOUT:\n${standardOutput}\nSTDERR:\n${standardError}`,
            ),
          );
        }
      });
    });
  });
});
