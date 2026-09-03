/**
 * @module ui
 * UI element management, window updates, and scroll/visibility intersection observers.
 */

import { state, updateState } from "./state.js";
import { renderPageContainer, unrenderPageContainer } from "./pdf.js";

const elements = {
  messageOverlay: document.getElementById("message-overlay"),
  container: document.getElementById("container"),
  messageText: document.getElementById("message-text"),
  openFileBtn: document.getElementById("open-file-btn"),
  pdfControls: document.getElementById("pdf-controls"),
  zoomSelect: document.getElementById("zoom-select"),
  pageInput: document.getElementById("page-input"),
  pageCountText: document.getElementById("page-count-text"),
  printBtn: document.getElementById("print-btn"),
  closeBtn: document.getElementById("close-btn"),
  appTitleText: document.getElementById("app-title-text"),
};

/**
 * Retrieves the cached DOM element references for the application UI.
 * @returns {typeof elements} The UI elements object.
 */
export function getUIElements() {
  return elements;
}

/**
 * Updates the application window title text based on the active file.
 * @param {string|null} filePath - Absolute path to the currently open PDF file.
 * @returns {void}
 */
export function updateWindowTitle(filePath) {
  if (!elements.appTitleText) {
    return;
  }
  if (filePath) {
    const fileName = filePath.split(/[/\\]/).pop();
    elements.appTitleText.textContent = `SmoothPDF - ${fileName}`;
  } else {
    elements.appTitleText.textContent = "SmoothPDF";
  }
}

/**
 * Displays an informational or status overlay message to the user.
 * @param {string} message - Status message text to display.
 * @returns {void}
 */
export function showMessage(message) {
  if (elements.messageText) {
    elements.messageText.textContent = message;
  }
  if (elements.messageOverlay) {
    elements.messageOverlay.classList.remove("hidden");
  }
  if (elements.container) {
    elements.container.classList.add("hidden");
  }
}

/**
 * Hides the informational message overlay and displays the PDF viewport container.
 * @returns {void}
 */
export function hideMessage() {
  if (elements.messageOverlay) {
    elements.messageOverlay.classList.add("hidden");
  }
  if (elements.container) {
    elements.container.classList.remove("hidden");
  }
}

/**
 * Synchronizes toolbar input and text elements with current application state.
 * @returns {void}
 */
export function updateControlsUI() {
  if (elements.pageCountText) {
    elements.pageCountText.textContent = `/ ${state.totalPages}`;
  }
  if (elements.zoomSelect) {
    elements.zoomSelect.value = state.currentZoomMode;
  }
  if (elements.pageInput) {
    elements.pageInput.value = state.currentPageNumber;
  }
}

/**
 * Sets up an intersection observer to track the active page number during scrolling.
 * @param {HTMLElement} layerElement - The container layer element to observe.
 * @returns {Promise<void>}
 */
export async function setupPageObserver(layerElement) {
  if (state.pageObserver) {
    state.pageObserver.disconnect();
  }

  const pageObserver = new IntersectionObserver(
    (entries) => {
      if (state.ignoreScrollEvents) {
        return;
      }

      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const pageNumber = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNumber && pageNumber !== state.currentPageNumber) {
            await updateState({ currentPageNumber: pageNumber });
            if (elements.pageInput) {
              elements.pageInput.value = state.currentPageNumber;
            }
          }
        }
      });
    },
    {
      root: layerElement,
      rootMargin: "-50% 0px -50% 0px",
      threshold: 0,
    },
  );

  await updateState({ pageObserver });

  const containers = layerElement.querySelectorAll(".page-container");
  containers.forEach((container) => pageObserver.observe(container));
}

/**
 * Sets up an intersection observer to lazily render and unrender pages as they enter or leave viewport.
 * @param {HTMLElement} layerElement - The container layer element to observe.
 * @param {import("pdfjs-dist").PDFDocumentProxy} pdfDocument - The active PDF document instance.
 * @returns {Promise<void>}
 */
export async function setupVisibilityObserver(layerElement, pdfDocument) {
  if (state.visibilityObserver) {
    state.visibilityObserver.disconnect();
  }

  const visibilityObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const pageContainer = entry.target;
        if (entry.isIntersecting) {
          renderPageContainer(pageContainer, pdfDocument).catch((err) => {
            console.error("Error rendering visible page container:", err);
          });
        } else {
          unrenderPageContainer(pageContainer);
        }
      });
    },
    {
      root: layerElement,
      rootMargin: "1200px 0px 1200px 0px",
      threshold: 0,
    },
  );

  await updateState({ visibilityObserver });

  const containers = layerElement.querySelectorAll(".page-container");
  containers.forEach((container) => visibilityObserver.observe(container));
}
