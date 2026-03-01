export const state = {
  currentPdfPath: null,
  currentPdfDocument: null,
  isRendering: false,
  pendingRenderOptions: null,
  currentZoomMode: "1.25",
  totalPages: 0,
  currentPageNumber: 1,
  pageObserver: null,
  ignoreScrollEvents: false,

  // UI state layer elements
  currentFront: document.getElementById("layer-1"),
  currentBack: document.getElementById("layer-2"),
};

export async function updateState(updates) {
  if (
    updates.currentPdfDocument !== undefined &&
    state.currentPdfDocument !== null &&
    state.currentPdfDocument !== updates.currentPdfDocument
  ) {
    try {
      await state.currentPdfDocument.destroy();
    } catch (err) {
      console.warn("Error destroying previous PDF document:", err);
    }
  }

  Object.assign(state, updates);
}
