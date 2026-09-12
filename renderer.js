/**
 * @module renderer
 * Main renderer orchestration, crossfade transitions, event handling, and initialization.
 */

import { state, destroyPdfDocument } from "./js/state.js";
import {
  getUIElements,
  updateWindowTitle,
  showMessage,
  hideMessage,
  updateControlsUI,
  setupPageObserver,
  setupVisibilityObserver,
} from "./js/ui.js";
import {
  loadPdfDocument,
  jumpToPage,
  renderDocumentToLayer,
  renderVisiblePages,
  renderAllPagesForPrint,
  cancelAllRenderTasks,
} from "./js/pdf.js";

const ui = getUIElements();

/**
 * Processes queued crossfade render options or resets active rendering state.
 * @returns {void}
 */
function handlePendingOrUnlock() {
  if (state.pendingRenderOptions) {
    const pendingOptions = state.pendingRenderOptions;
    state.pendingRenderOptions = null;
    performCrossfadeUpdate(
      pendingOptions.filePath || state.currentPdfPath,
      pendingOptions.anchorPage,
      pendingOptions.isInstant,
      pendingOptions.forceReload,
    );
  } else {
    state.isRendering = false;
  }
}

/**
 * Executes a smooth crossfade transition between two layer elements.
 * @param {string} filePath - Path of the target PDF document.
 * @param {number|null} [anchorPage=null] - Page number to maintain scroll alignment.
 * @param {boolean} [isInstant=false] - Whether to bypass animated opacity transition.
 * @param {boolean} [forceReload=false] - Whether to re-fetch document from disk.
 * @returns {Promise<void>}
 */
async function performCrossfadeUpdate(
  filePath,
  anchorPage = null,
  isInstant = false,
  forceReload = false,
) {
  state.isRendering = true;
  const currentRenderPass = ++state.renderPassIdentifier;
  try {
    const supersededDocument = state.currentPdfDocument;
    const activePageNumber = state.currentPageNumber || 1;
    const currentScrollPosition = state.currentFront
      ? state.currentFront.scrollTop
      : 0;
    const targetAnchorPage =
      anchorPage !== null ? anchorPage : activePageNumber;

    let relativeOffset = 0;
    if (targetAnchorPage && state.currentFront) {
      const oldAnchorCanvas = state.currentFront.querySelector(
        `.page-container[data-page-number="${targetAnchorPage}"]`,
      );
      if (oldAnchorCanvas && oldAnchorCanvas.offsetHeight > 0) {
        const distanceIntoPage =
          currentScrollPosition + 16 - oldAnchorCanvas.offsetTop;
        relativeOffset = distanceIntoPage / oldAnchorCanvas.offsetHeight;
      }
    }

    const resolvedPath = filePath || state.currentPdfPath;
    let newDocument;
    if (
      !forceReload &&
      resolvedPath === state.currentPdfPath &&
      state.currentPdfDocument &&
      !state.currentPdfDocument.destroyed
    ) {
      newDocument = state.currentPdfDocument;
    } else {
      newDocument = await loadPdfDocument(resolvedPath);
    }

    if (state.renderPassIdentifier !== currentRenderPass) {
      if (newDocument && newDocument !== supersededDocument) {
        await destroyPdfDocument(newDocument);
      }
      return;
    }

    const targetPage = Math.max(
      1,
      Math.min(targetAnchorPage, newDocument.numPages),
    );
    if (!state.pendingRenderOptions) {
      state.currentPdfPath = resolvedPath;
    }
    state.totalPages = newDocument.numPages;
    state.currentPageNumber = targetPage;
    updateControlsUI();

    const anchorCanvas = await renderDocumentToLayer(
      newDocument,
      state.currentBack,
      targetPage,
    );

    if (state.renderPassIdentifier !== currentRenderPass) {
      if (newDocument && newDocument !== supersededDocument) {
        await destroyPdfDocument(newDocument);
      }
      return;
    }

    let calculatedScrollTop = currentScrollPosition;
    if (anchorCanvas) {
      calculatedScrollTop =
        anchorCanvas.offsetTop -
        16 +
        relativeOffset * anchorCanvas.offsetHeight;
    }
    if (state.currentBack.clientHeight > 0) {
      const maximumBackScroll = Math.max(
        0,
        state.currentBack.scrollHeight - state.currentBack.clientHeight,
      );
      calculatedScrollTop = Math.min(calculatedScrollTop, maximumBackScroll);
    }
    state.currentBack.scrollTop = Math.max(0, calculatedScrollTop);

    await renderVisiblePages(state.currentBack, newDocument);

    if (state.renderPassIdentifier !== currentRenderPass) {
      if (newDocument && newDocument !== supersededDocument) {
        await destroyPdfDocument(newDocument);
      }
      return;
    }

    if (state.pageObserver) {
      state.pageObserver.disconnect();
      state.pageObserver = null;
    }
    if (state.visibilityObserver) {
      state.visibilityObserver.disconnect();
      state.visibilityObserver = null;
    }

    state.currentBack.style.transition = "none";
    state.currentBack.classList.remove("hidden");
    void state.currentBack.offsetWidth;

    if (isInstant) {
      state.currentFront.style.transition = "none";
    } else {
      state.currentBack.style.transition = "";
    }

    state.currentFront.classList.add("hidden");

    if (!isInstant) {
      await Promise.race([
        new Promise((resolve) => {
          const onTransitionEnd = (transitionEvent) => {
            if (
              transitionEvent.target === state.currentFront &&
              transitionEvent.propertyName === "opacity"
            ) {
              state.currentFront.removeEventListener(
                "transitionend",
                onTransitionEnd,
              );
              resolve();
            }
          };
          state.currentFront.addEventListener(
            "transitionend",
            onTransitionEnd,
          );
        }),
        new Promise((resolve) => setTimeout(resolve, 600)),
      ]);
    }

    state.currentBack.classList.add("is-front");
    state.currentBack.classList.remove("is-back");
    state.currentFront.classList.add("is-back");
    state.currentFront.classList.remove("is-front");

    cancelAllRenderTasks(state.currentFront);
    state.currentFront.innerHTML = "";
    state.currentFront.scrollTop = 0;

    if (isInstant) {
      void state.currentFront.offsetWidth;
      void state.currentBack.offsetWidth;
      state.currentFront.style.transition = "";
      state.currentBack.style.transition = "";
    }

    const previousFrontLayer = state.currentFront;
    state.currentFront = state.currentBack;
    state.currentBack = previousFrontLayer;
    state.currentPdfDocument = newDocument;

    if (supersededDocument && supersededDocument !== newDocument) {
      await destroyPdfDocument(supersededDocument);
    }

    setupPageObserver(state.currentFront);
    setupVisibilityObserver(state.currentFront, newDocument);
    updateControlsUI();
    hideMessage();
  } catch (crossfadeError) {
    console.error("Crossfade update error:", crossfadeError);
  } finally {
    handlePendingOrUnlock();
  }
}

/**
 * Loads a PDF document and renders initial visible pages onto the front layer.
 * @param {string} filePath - Absolute path to the PDF document.
 * @returns {Promise<void>}
 */
async function loadAndRenderPdf(filePath) {
  state.isRendering = true;
  const currentRenderPass = ++state.renderPassIdentifier;
  try {
    const pdfDocument = await loadPdfDocument(filePath);
    if (state.renderPassIdentifier !== currentRenderPass) {
      await destroyPdfDocument(pdfDocument);
      return;
    }
    const supersededDocument = state.currentPdfDocument;
    state.currentPdfPath = filePath;
    state.currentPdfDocument = pdfDocument;
    state.totalPages = pdfDocument.numPages;
    state.currentPageNumber = 1;

    updateControlsUI();
    if (ui.pdfControls) {
      ui.pdfControls.classList.remove("hidden");
    }

    await renderDocumentToLayer(pdfDocument, state.currentFront);
    await renderVisiblePages(state.currentFront, pdfDocument);

    if (supersededDocument && supersededDocument !== pdfDocument) {
      await destroyPdfDocument(supersededDocument);
    }

    setupPageObserver(state.currentFront);
    setupVisibilityObserver(state.currentFront, pdfDocument);
    hideMessage();
  } catch (initialLoadError) {
    console.error("Initial load error:", initialLoadError);
    showMessage("Failed to load initial PDF");
  } finally {
    handlePendingOrUnlock();
  }
}

/**
 * Closes the currently active PDF document and resets UI state.
 * @returns {Promise<void>}
 */
async function closePdf() {
  try {
    await window.api.closeFile();
    if (state.pageObserver) {
      state.pageObserver.disconnect();
      state.pageObserver = null;
    }
    if (state.visibilityObserver) {
      state.visibilityObserver.disconnect();
      state.visibilityObserver = null;
    }
    if (state.currentFront) {
      cancelAllRenderTasks(state.currentFront);
      state.currentFront.innerHTML = "";
    }
    if (state.currentBack) {
      cancelAllRenderTasks(state.currentBack);
      state.currentBack.innerHTML = "";
    }
    const supersededDocument = state.currentPdfDocument;
    state.currentPdfPath = null;
    state.currentPdfDocument = null;
    state.totalPages = 0;
    state.currentPageNumber = 1;
    state.pendingRenderOptions = null;
    state.isRendering = false;

    if (supersededDocument) {
      await destroyPdfDocument(supersededDocument);
    }

    if (ui.pdfControls) {
      ui.pdfControls.classList.add("hidden");
    }
    updateWindowTitle(null);

    if (ui.openFileBtn) {
      ui.openFileBtn.classList.remove("hidden");
    }

    showMessage("No PDF loaded. Click 'Open PDF' to begin.");
  } catch (closeError) {
    console.error("Error closing file:", closeError);
  }
}

let resizeDebounceTimer = null;
if (ui.container) {
  const containerObserver = new ResizeObserver(() => {
    if (!state.currentPdfPath) {
      return;
    }
    clearTimeout(resizeDebounceTimer);
    resizeDebounceTimer = setTimeout(async () => {
      if (!state.isRendering) {
        state.isRendering = true;
        await performCrossfadeUpdate(
          state.currentPdfPath,
          state.currentPageNumber,
          true,
          false,
        );
      } else {
        state.pendingRenderOptions = {
          filePath: state.currentPdfPath,
          anchorPage: state.currentPageNumber,
          isInstant: true,
          forceReload: false,
        };
      }
    }, 150);
  });
  containerObserver.observe(ui.container);
}

window.addEventListener("keydown", async (keyboardEvent) => {
  if (!state.currentPdfPath) {
    return;
  }

  if (
    (keyboardEvent.ctrlKey || keyboardEvent.metaKey) &&
    (keyboardEvent.key === "=" ||
      keyboardEvent.key === "+" ||
      keyboardEvent.key === "-")
  ) {
    keyboardEvent.preventDefault();
    let nextZoomMode = state.currentZoomMode;

    if (
      state.currentZoomMode === "fit-width" ||
      state.currentZoomMode === "fit-height"
    ) {
      nextZoomMode = "1";
    } else {
      const zoomLevelScaleSteps = [
        0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
      ];
      const currentZoomValue = parseFloat(state.currentZoomMode);
      const currentStepIndex = zoomLevelScaleSteps.findIndex(
        (zoomStep) => Math.abs(zoomStep - currentZoomValue) < 0.01,
      );

      if (currentStepIndex === -1) {
        nextZoomMode = "1";
      } else if (keyboardEvent.key === "-" && currentStepIndex > 0) {
        nextZoomMode = zoomLevelScaleSteps[currentStepIndex - 1].toString();
      } else if (
        (keyboardEvent.key === "=" || keyboardEvent.key === "+") &&
        currentStepIndex < zoomLevelScaleSteps.length - 1
      ) {
        nextZoomMode = zoomLevelScaleSteps[currentStepIndex + 1].toString();
      }
    }

    if (nextZoomMode !== state.currentZoomMode) {
      state.currentZoomMode = nextZoomMode;
      updateControlsUI();

      if (state.isRendering) {
        state.pendingRenderOptions = {
          filePath: state.currentPdfPath,
          anchorPage: state.currentPageNumber,
          isInstant: true,
          forceReload: false,
        };
      } else {
        state.isRendering = true;
        await performCrossfadeUpdate(
          state.currentPdfPath,
          state.currentPageNumber,
          true,
          false,
        );
      }
    }
  }
});

if (ui.zoomSelect) {
  ui.zoomSelect.addEventListener("change", async (changeEvent) => {
    const targetPdfPath = state.currentPdfPath;
    if (!targetPdfPath && !state.currentPdfDocument) {
      changeEvent.target.value = state.currentZoomMode;
      return;
    }
    state.currentZoomMode = changeEvent.target.value;
    updateControlsUI();
    if (state.isRendering) {
      state.pendingRenderOptions = {
        filePath: targetPdfPath,
        anchorPage: state.currentPageNumber,
        isInstant: true,
        forceReload: false,
      };
    } else {
      state.isRendering = true;
      await performCrossfadeUpdate(
        targetPdfPath,
        state.currentPageNumber,
        true,
        false,
      );
    }
  });
}

if (ui.pageInput) {
  ui.pageInput.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Enter") {
      jumpToPage(ui.pageInput.value);
      ui.pageInput.blur();
    }
  });

  ui.pageInput.addEventListener("blur", () => {
    jumpToPage(ui.pageInput.value);
  });
}

if (ui.closeBtn) {
  ui.closeBtn.addEventListener("click", async () => {
    await closePdf();
  });
}

if (ui.printBtn) {
  ui.printBtn.addEventListener("click", async () => {
    if (state.currentPdfPath && state.currentPdfDocument) {
      await renderAllPagesForPrint(
        state.currentFront,
        state.currentPdfDocument,
      );
      window.print();
    }
  });
}

window.addEventListener("beforeprint", async () => {
  if (state.currentPdfDocument && state.currentFront) {
    await renderAllPagesForPrint(
      state.currentFront,
      state.currentPdfDocument,
    );
  }
});

window.addEventListener("afterprint", () => {
  if (state.currentPdfDocument && state.currentFront) {
    setupVisibilityObserver(state.currentFront, state.currentPdfDocument);
  }
});

if (ui.openFileBtn) {
  ui.openFileBtn.addEventListener("click", async () => {
    try {
      const selectedPath = await window.api.selectFile();
      if (selectedPath) {
        state.currentPdfPath = selectedPath;
        updateWindowTitle(selectedPath);
        ui.openFileBtn.classList.add("hidden");
        showMessage("Loading PDF...");
        await loadAndRenderPdf(selectedPath);
      }
    } catch (openError) {
      console.error("Error opening file:", openError);
    }
  });
}

window.addEventListener("contextmenu", (contextMenuEvent) => {
  const activeSelection = window.getSelection();
  if (activeSelection && activeSelection.toString().trim() !== "") {
    contextMenuEvent.preventDefault();
    window.api.showContextMenu();
  }
});

/**
 * Initializes application state, checks initial launch arguments, and sets up file watchers.
 * @returns {Promise<void>}
 */
async function init() {
  try {
    const startupFilePath = await window.api.getFilePath();
    if (startupFilePath) {
      state.currentPdfPath = startupFilePath;
      updateWindowTitle(startupFilePath);
      ui.openFileBtn.classList.add("hidden");
      showMessage("Loading PDF...");
      await loadAndRenderPdf(startupFilePath);
    } else {
      showMessage("No PDF loaded. Click 'Open PDF' to begin.");
    }

    window.api.onFileUpdated(async (updatedPath) => {
      if (state.isRendering) {
        state.pendingRenderOptions = {
          filePath: updatedPath,
          anchorPage: null,
          isInstant: false,
          forceReload: true,
        };
        state.currentPdfPath = updatedPath;
        return;
      }
      state.currentPdfPath = updatedPath;
      state.isRendering = true;
      await performCrossfadeUpdate(updatedPath, null, false, true);
    });
  } catch (initError) {
    console.error("Init Error:", initError);
    showMessage("Application Init Failed");
  }
}

init();
