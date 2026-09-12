/**
 * @module state
 * Centralized application state management for SmoothPDF.
 */

/**
 * Global reactive application state.
 */
export const state = {
  currentPdfPath: null,
  currentPdfDocument: null,
  isRendering: false,
  pendingRenderOptions: null,
  currentZoomMode: "1.25",
  totalPages: 0,
  currentPageNumber: 1,
  isScrollNavigating: false,
  pageObserver: null,
  visibilityObserver: null,
  ignoreScrollEvents: false,
  currentFront: document.getElementById("layer-1"),
  currentBack: document.getElementById("layer-2"),
  renderPassIdentifier: 0,
};

/**
 * Destroys a superseded PDF document proxy after detachment.
 * @param {import("pdfjs-dist").PDFDocumentProxy|null} documentProxy - PDF document proxy to destroy.
 * @returns {Promise<void>}
 */
export async function destroyPdfDocument(documentProxy) {
  if (!documentProxy) {
    return;
  }
  try {
    await documentProxy.destroy();
  } catch (destroyError) {
    console.error("Error destroying superseded PDF document:", destroyError);
  }
}

/**
 * Updates application state properties.
 * @param {Partial<typeof state>} updates - Properties to update.
 * @returns {Promise<void>}
 */
export async function updateState(updates) {
  Object.assign(state, updates);
}
