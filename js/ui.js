import { state, updateState } from "./state.js";

// DOM Elements
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
  welcomeIcon: document.getElementById("welcome-icon"),
};

export function getUIElements() {
  return elements;
}

export function updateWindowTitle(filePath) {
  if (!elements.appTitleText) return;
  if (filePath) {
    const fileName = filePath.split(/[/\\]/).pop();
    elements.appTitleText.textContent = `Smooth PDF - ${fileName}`;
  } else {
    elements.appTitleText.textContent = "Smooth PDF";
  }
}

export function showMessage(msg) {
  if (elements.messageText) elements.messageText.textContent = msg;
  if (elements.messageOverlay)
    elements.messageOverlay.classList.remove("hidden");
  if (elements.container) elements.container.classList.add("hidden");
}

export function hideMessage() {
  if (elements.messageOverlay) elements.messageOverlay.classList.add("hidden");
  if (elements.container) elements.container.classList.remove("hidden");
}

export function updateControlsUI() {
  if (elements.pageCountText)
    elements.pageCountText.textContent = `/ ${state.totalPages}`;
  if (elements.zoomSelect) elements.zoomSelect.value = state.currentZoomMode;
  if (elements.pageInput) elements.pageInput.value = state.currentPageNumber;
}

export async function setupPageObserver(layerElement) {
  if (state.pageObserver) {
    state.pageObserver.disconnect();
  }

  const newObserver = new IntersectionObserver(
    (entries) => {
      if (state.ignoreScrollEvents) return;

      entries.forEach(async (entry) => {
        if (entry.isIntersecting) {
          const pageNum = parseInt(entry.target.dataset.pageNumber, 10);
          if (pageNum && pageNum !== state.currentPageNumber) {
            await updateState({ currentPageNumber: pageNum });
            if (elements.pageInput)
              elements.pageInput.value = state.currentPageNumber;
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

  await updateState({ pageObserver: newObserver });

  const containers = layerElement.querySelectorAll(".page-container");
  containers.forEach((c) => state.pageObserver.observe(c));
}
