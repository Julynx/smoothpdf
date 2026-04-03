import { state, updateState } from "./js/state.js";
import {
  getUIElements,
  updateWindowTitle,
  showMessage,
  hideMessage,
  updateControlsUI,
  setupPageObserver,
} from "./js/ui.js";
import {
  loadPdfDocument,
  jumpToPage,
  renderDocumentToLayer,
} from "./js/pdf.js";

const ui = getUIElements();

async function performCrossfadeUpdate(
  filePath,
  anchorPage = null,
  isInstant = false,
  forceReload = false,
) {
  await updateState({ isRendering: true });
  try {
    let doc;
    if (
      !forceReload &&
      filePath === state.currentPdfPath &&
      state.currentPdfDocument
    ) {
      doc = state.currentPdfDocument;
    } else {
      doc = await loadPdfDocument(filePath);
      await updateState({ currentPdfDocument: doc });
    }

    await updateState({ totalPages: doc.numPages });
    updateControlsUI();

    const currentScrollPos = state.currentFront.scrollTop;

    let relativeOffset = 0;
    if (anchorPage) {
      const oldAnchorCanvas = state.currentFront.querySelector(
        `.page-container[data-page-number="${anchorPage}"]`,
      );
      if (oldAnchorCanvas) {
        const distanceIntoPage =
          currentScrollPos + 16 - oldAnchorCanvas.offsetTop;
        relativeOffset = distanceIntoPage / oldAnchorCanvas.offsetHeight;
      }
    }

    const anchorCanvas = await renderDocumentToLayer(
      doc,
      state.currentBack,
      anchorPage,
    );

    if (anchorCanvas) {
      const newScrollTop =
        anchorCanvas.offsetTop -
        16 +
        relativeOffset * anchorCanvas.offsetHeight;
      state.currentBack.scrollTop = Math.max(0, newScrollTop);
    } else {
      state.currentBack.scrollTop = currentScrollPos;
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
      await new Promise((resolve) => {
        state.currentFront.addEventListener("transitionend", resolve, {
          once: true,
        });
      });
    }

    state.currentBack.classList.add("is-front");
    state.currentBack.classList.remove("is-back");
    state.currentFront.classList.add("is-back");
    state.currentFront.classList.remove("is-front");

    state.currentFront.innerHTML = "";
    setupPageObserver(state.currentBack);

    if (isInstant) {
      void state.currentFront.offsetWidth;
      void state.currentBack.offsetWidth;
      state.currentFront.style.transition = "";
      state.currentBack.style.transition = "";
    }

    const temp = state.currentFront;
    await updateState({ currentFront: state.currentBack, currentBack: temp });
  } catch (err) {
    console.error(err);
  } finally {
    await updateState({ isRendering: false });
    checkPending();
  }
}

async function loadAndRenderPdf(filePath) {
  await updateState({ isRendering: true });
  try {
    const doc = await loadPdfDocument(filePath);
    await updateState({ currentPdfDocument: doc, totalPages: doc.numPages });

    updateControlsUI();
    if (ui.pdfControls) ui.pdfControls.classList.remove("hidden");

    await renderDocumentToLayer(doc, state.currentFront);
    setupPageObserver(state.currentFront);
    hideMessage();
  } catch (err) {
    console.error(err);
    showMessage("Failed to load initial PDF");
  } finally {
    await updateState({ isRendering: false });
    checkPending();
  }
}

async function checkPending() {
  if (state.pendingRenderOptions) {
    const options = state.pendingRenderOptions;
    await updateState({ pendingRenderOptions: null });
    performCrossfadeUpdate(
      state.currentPdfPath,
      options.anchorPage,
      options.isInstant,
      options.forceReload,
    );
  }
}

async function closePdf() {
  try {
    await window.api.closeFile();
    await updateState({
      currentPdfPath: null,
      currentPdfDocument: null,
      totalPages: 0,
      currentPageNumber: 1,
    });

    if (state.pageObserver) {
      state.pageObserver.disconnect();
      await updateState({ pageObserver: null });
    }

    state.currentFront.innerHTML = "";
    state.currentBack.innerHTML = "";

    if (ui.pdfControls) ui.pdfControls.classList.add("hidden");
    updateWindowTitle(null);

    if (ui.openFileBtn) ui.openFileBtn.classList.remove("hidden");
    if (ui.welcomeIcon) ui.welcomeIcon.classList.remove("hidden");

    showMessage("No PDF loaded. Click 'Open PDF' to begin.");
  } catch (err) {
    console.error("Error closing file:", err);
  }
}

// Global Event Listeners
let resizeTimeout;
const containerObserver = new ResizeObserver(() => {
  if (!state.currentPdfPath) return;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    if (!state.isRendering) {
      await performCrossfadeUpdate(
        state.currentPdfPath,
        state.currentPageNumber,
        true,
      );
    } else {
      await updateState({
        pendingRenderOptions: {
          anchorPage: state.currentPageNumber,
          isInstant: true,
        },
      });
    }
  }, 150);
});

if (ui.container) {
  containerObserver.observe(ui.container);
}

window.addEventListener("keydown", async (e) => {
  if (!state.currentPdfPath) return;

  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === "=" || e.key === "+" || e.key === "-")
  ) {
    e.preventDefault();
    let newZoomMode = state.currentZoomMode;

    if (
      state.currentZoomMode === "fit-width" ||
      state.currentZoomMode === "fit-height"
    ) {
      newZoomMode = "1";
    } else {
      const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
      const currentZoomFloat = parseFloat(state.currentZoomMode);
      const currentIndex = zoomLevels.findIndex(
        (z) => Math.abs(z - currentZoomFloat) < 0.01,
      );

      if (currentIndex === -1) {
        newZoomMode = "1";
      } else {
        if (e.key === "-" && currentIndex > 0) {
          newZoomMode = zoomLevels[currentIndex - 1].toString();
        } else if (
          (e.key === "=" || e.key === "+") &&
          currentIndex < zoomLevels.length - 1
        ) {
          newZoomMode = zoomLevels[currentIndex + 1].toString();
        }
      }
    }

    if (newZoomMode !== state.currentZoomMode) {
      await updateState({ currentZoomMode: newZoomMode });
      updateControlsUI();

      if (state.isRendering) {
        await updateState({
          pendingRenderOptions: {
            anchorPage: state.currentPageNumber,
            isInstant: true,
          },
        });
      } else {
        performCrossfadeUpdate(
          state.currentPdfPath,
          state.currentPageNumber,
          true,
        );
      }
    }
  }
});

if (ui.zoomSelect) {
  ui.zoomSelect.addEventListener("change", async (e) => {
    if (!state.currentPdfPath) {
      e.target.value = state.currentZoomMode;
      return;
    }
    await updateState({ currentZoomMode: e.target.value });
    updateControlsUI();
    if (state.isRendering) {
      await updateState({
        pendingRenderOptions: {
          anchorPage: state.currentPageNumber,
          isInstant: true,
        },
      });
    } else {
      performCrossfadeUpdate(
        state.currentPdfPath,
        state.currentPageNumber,
        true,
      );
    }
  });
}

if (ui.pageInput) {
  ui.pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
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
  ui.printBtn.addEventListener("click", () => {
    if (state.currentPdfPath) {
      window.print();
    }
  });
}

if (ui.openFileBtn) {
  ui.openFileBtn.addEventListener("click", async () => {
    try {
      const filePath = await window.api.selectFile();
      if (filePath) {
        await updateState({ currentPdfPath: filePath });
        updateWindowTitle(filePath);
        ui.openFileBtn.classList.add("hidden");
        if (ui.welcomeIcon) ui.welcomeIcon.classList.add("hidden");
        showMessage("Loading your beautiful PDF...");
        await loadAndRenderPdf(filePath);
      }
    } catch (err) {
      console.error("Error opening file:", err);
    }
  });
}

window.addEventListener("contextmenu", (e) => {
  const selection = window.getSelection();
  if (selection && selection.toString().trim() !== "") {
    e.preventDefault();
    window.api.showContextMenu();
  }
});

// Initialization
async function init() {
  try {
    const filePath = await window.api.getFilePath();
    if (filePath) {
      await updateState({ currentPdfPath: filePath });
      updateWindowTitle(filePath);
      ui.openFileBtn.classList.add("hidden");
      if (ui.welcomeIcon) ui.welcomeIcon.classList.add("hidden");
      showMessage("Loading your beautiful PDF...");
      await loadAndRenderPdf(filePath);
    } else {
      showMessage("No PDF loaded. Click 'Open PDF' to begin.");
    }

    window.api.onFileUpdated(async (updatedPath) => {
      await updateState({ currentPdfPath: updatedPath });
      if (state.isRendering) {
        await updateState({
          pendingRenderOptions: {
            anchorPage: null,
            isInstant: false,
            forceReload: true,
          },
        });
      } else {
        await performCrossfadeUpdate(updatedPath, null, false, true);
      }
    });
  } catch (err) {
    console.error("Init Error:", err);
    showMessage("Application Init Failed");
  }
}

init();
