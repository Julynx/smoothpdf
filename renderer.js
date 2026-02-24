import * as pdfjsLib from "./node_modules/pdfjs-dist/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "./node_modules/pdfjs-dist/build/pdf.worker.mjs";

const messageOverlay = document.getElementById("message-overlay");
const container = document.getElementById("container");
const messageText = document.getElementById("message-text");
const openFileBtn = document.getElementById("open-file-btn");
const pdfControls = document.getElementById("pdf-controls");
const zoomOutBtn = document.getElementById("zoom-out-btn");
const zoomInBtn = document.getElementById("zoom-in-btn");
const zoomLevelText = document.getElementById("zoom-level-text");
const pageInput = document.getElementById("page-input");
const pageCountText = document.getElementById("page-count-text");
const closeBtn = document.getElementById("close-btn");

let currentFront = document.getElementById("layer-1");
let currentBack = document.getElementById("layer-2");

let currentPdfPath = null;
let isRendering = false;
let pendingRender = false;

const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 3.0, 4.0];
let currentZoomIndex = 2; // 2 = 1.0 (100%)
let isFitMode = true;
let totalPages = 0;
let currentPageNumber = 1;
let pageObserver = null;
let ignoreScrollEvents = false;

async function init() {
  try {
    currentPdfPath = await window.api.getFilePath();
    if (currentPdfPath) {
      await loadAndRenderPdf(currentPdfPath);
    } else {
      showMessage("No PDF loaded. Click 'Open PDF' to begin.");
    }

    window.api.onFileUpdated(async (filePath) => {
      currentPdfPath = filePath;
      if (isRendering) {
        pendingRender = true;
      } else {
        await performCrossfadeUpdate(filePath);
      }
    });
  } catch (err) {
    console.error("Init Error:", err);
    showMessage("Application Init Failed");
  }
}

function showMessage(msg) {
  messageText.textContent = msg;
  messageOverlay.classList.remove("hidden");
  container.classList.add("hidden");
}

function hideMessage() {
  messageOverlay.classList.add("hidden");
  container.classList.remove("hidden");
}

async function loadPdfDocument(filePath) {
  const buffer = await window.api.getFile(filePath);
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  return await loadingTask.promise;
}

async function renderDocumentToLayer(
  pdfDocument,
  targetLayer,
  pageToAnchor = null,
) {
  targetLayer.innerHTML = "";

  // Using scrollbar-adjusted width to avoid overflow
  const targetWidth = targetLayer.clientWidth * 0.9;

  let targetAnchorCanvas = null;

  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const page = await pdfDocument.getPage(pageNum);
    const unscaledViewport = page.getViewport({ scale: 1.0 });

    let finalScale = 1.0;
    if (isFitMode) {
      finalScale = targetWidth / unscaledViewport.width;
      finalScale = Math.min(Math.max(finalScale, 0.2), 4.0);
    } else {
      finalScale = ZOOM_LEVELS[currentZoomIndex];
    }

    const viewport = page.getViewport({ scale: finalScale });

    const canvas = document.createElement("canvas");
    canvas.dataset.pageNumber = pageNum;
    if (pageNum === pageToAnchor) {
      targetAnchorCanvas = canvas;
    }

    const context = canvas.getContext("2d");

    const outputScale = window.devicePixelRatio || 1;

    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";

    const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

    targetLayer.appendChild(canvas);

    const renderContext = { canvasContext: context, transform, viewport };
    await page.render(renderContext).promise;
  }

  return targetAnchorCanvas;
}

function setupPageObserver(layerElement) {
  if (pageObserver) {
    pageObserver.disconnect();
  }

  pageObserver = new IntersectionObserver(
    (entries) => {
      if (ignoreScrollEvents) return;

      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNum && pageNum !== currentPageNumber) {
            currentPageNumber = pageNum;
            if (pageInput) pageInput.value = currentPageNumber;
          }
        }
      });
    },
    {
      root: layerElement,
      rootMargin: "-50% 0px -50% 0px", // Trigger when crossing middle of viewport
      threshold: 0,
    },
  );

  const canvases = layerElement.querySelectorAll("canvas");
  canvases.forEach((c) => pageObserver.observe(c));
}

function updateControlsUI() {
  if (pageCountText) pageCountText.textContent = `/ ${totalPages}`;

  if (isFitMode) {
    zoomLevelText.textContent = "Fit";
    zoomInBtn.disabled = true;
    zoomOutBtn.disabled = true;
  } else {
    const zoomVal = ZOOM_LEVELS[currentZoomIndex];
    zoomLevelText.textContent = `${Math.round(zoomVal * 100)}%`;
    zoomInBtn.disabled = currentZoomIndex >= ZOOM_LEVELS.length - 1;
    zoomOutBtn.disabled = currentZoomIndex <= 0;
  }
}

async function loadAndRenderPdf(filePath) {
  isRendering = true;
  try {
    const doc = await loadPdfDocument(filePath);
    totalPages = doc.numPages;
    updateControlsUI();
    pdfControls.classList.remove("hidden");

    await renderDocumentToLayer(doc, currentFront);
    setupPageObserver(currentFront);
    hideMessage();
  } catch (err) {
    console.error(err);
    showMessage("Failed to load initial PDF");
  } finally {
    isRendering = false;
    checkPending();
  }
}

async function performCrossfadeUpdate(filePath, anchorPage = null) {
  isRendering = true;
  try {
    const doc = await loadPdfDocument(filePath);
    totalPages = doc.numPages;
    updateControlsUI();

    const currentScrollPos = currentFront.scrollTop;

    // Render to back layer
    const anchorCanvas = await renderDocumentToLayer(
      doc,
      currentBack,
      anchorPage,
    );
    if (anchorCanvas) {
      currentBack.scrollTop = anchorCanvas.offsetTop - 24;
    } else {
      currentBack.scrollTop = currentScrollPos;
    }

    // Reveal back instantly, without transition
    currentBack.style.transition = "none";
    currentBack.classList.remove("hidden");
    // Force reflow
    void currentBack.offsetWidth;
    currentBack.style.transition = "";

    // Fade out front
    currentFront.classList.add("hidden");

    // Wait for CSS transition to fully finish
    await new Promise((r) => setTimeout(r, 550));

    // Swap styles
    currentBack.classList.add("is-front");
    currentBack.classList.remove("is-back");
    currentFront.classList.add("is-back");
    currentFront.classList.remove("is-front");

    currentFront.innerHTML = "";
    setupPageObserver(currentBack);

    // Swap references
    const temp = currentFront;
    currentFront = currentBack;
    currentBack = temp;
  } catch (err) {
    console.error(err);
  } finally {
    isRendering = false;
    checkPending();
  }
}

function checkPending() {
  if (pendingRender) {
    pendingRender = false;
    performCrossfadeUpdate(currentPdfPath);
  }
}

let resizeTimeout;
window.addEventListener("resize", () => {
  if (!currentPdfPath) return;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    if (!isRendering) {
      await performCrossfadeUpdate(currentPdfPath, currentPageNumber);
    } else {
      pendingRender = true;
    }
  }, 500);
});

zoomLevelText.addEventListener("click", () => {
  if (!currentPdfPath || isRendering) return;
  isFitMode = !isFitMode;
  updateControlsUI();
  performCrossfadeUpdate(currentPdfPath, currentPageNumber);
});

zoomInBtn.addEventListener("click", () => {
  if (!currentPdfPath || isRendering || isFitMode) return;
  if (currentZoomIndex < ZOOM_LEVELS.length - 1) {
    currentZoomIndex++;
    updateControlsUI();
    performCrossfadeUpdate(currentPdfPath, currentPageNumber);
  }
});

zoomOutBtn.addEventListener("click", () => {
  if (!currentPdfPath || isRendering || isFitMode) return;
  if (currentZoomIndex > 0) {
    currentZoomIndex--;
    updateControlsUI();
    performCrossfadeUpdate(currentPdfPath, currentPageNumber);
  }
});

if (pageInput) {
  pageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      jumpToPage(pageInput.value);
      pageInput.blur();
    }
  });

  pageInput.addEventListener("blur", () => {
    jumpToPage(pageInput.value);
  });
}

function jumpToPage(inputVal) {
  if (!currentPdfPath) return;
  let targetPage = parseInt(inputVal, 10);
  if (isNaN(targetPage)) {
    if (pageInput) pageInput.value = currentPageNumber;
    return;
  }
  targetPage = Math.max(1, Math.min(targetPage, totalPages));
  if (pageInput) pageInput.value = targetPage;

  if (targetPage !== currentPageNumber) {
    currentPageNumber = targetPage;
    const targetCanvas = currentFront.querySelector(
      `canvas[data-page-number="${targetPage}"]`,
    );
    if (targetCanvas) {
      ignoreScrollEvents = true;
      currentFront.scrollTo({
        top: targetCanvas.offsetTop - 24,
        behavior: "smooth",
      });
      setTimeout(() => {
        ignoreScrollEvents = false;
      }, 500);
    }
  }
}

closeBtn.addEventListener("click", async () => {
  await closePdf();
});

async function closePdf() {
  try {
    await window.api.closeFile();
    currentPdfPath = null;
    totalPages = 0;
    currentPageNumber = 1;

    if (pageObserver) {
      pageObserver.disconnect();
      pageObserver = null;
    }

    currentFront.innerHTML = "";
    currentBack.innerHTML = "";

    pdfControls.classList.add("hidden");

    // Restore welcome screen elements
    openFileBtn.style.display = "";
    document.getElementById("welcome-icon").style.display = "";

    showMessage("No PDF loaded. Click 'Open PDF' to begin.");
  } catch (err) {
    console.error("Error closing file:", err);
  }
}

openFileBtn.addEventListener("click", async () => {
  try {
    const filePath = await window.api.selectFile();
    if (filePath) {
      currentPdfPath = filePath;
      openFileBtn.style.display = "none";
      document.getElementById("welcome-icon").style.display = "none";
      showMessage("Loading your beautiful PDF...");
      await loadAndRenderPdf(currentPdfPath);
    }
  } catch (err) {
    console.error("Error opening file:", err);
  }
});

init();
