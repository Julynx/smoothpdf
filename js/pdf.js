import * as pdfjsLib from '../public/pdf.mjs';
import { state, updateState } from './state.js';
import { getUIElements } from './ui.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../public/pdf.worker.mjs';

export async function loadPdfDocument(filePath) {
    const loadingTask = pdfjsLib.getDocument(`safe-file://${encodeURIComponent(filePath)}`);
    return await loadingTask.promise;
}

export function jumpToPage(inputVal) {
    if (!state.currentPdfPath) return;
    const elements = getUIElements();
    
    let targetPage = parseInt(inputVal, 10);
    if (isNaN(targetPage)) {
        if (elements.pageInput) elements.pageInput.value = state.currentPageNumber;
        return;
    }
    
    targetPage = Math.max(1, Math.min(targetPage, state.totalPages));
    if (elements.pageInput) elements.pageInput.value = targetPage;

    if (targetPage !== state.currentPageNumber) {
        updateState({ currentPageNumber: targetPage });
        
        const targetContainer = state.currentFront.querySelector(
            `.page-container[data-page-number="${targetPage}"]`
        );
        
        if (targetContainer) {
            updateState({ ignoreScrollEvents: true });
            
            let targetScrollTop = targetContainer.offsetTop - 64;
            if (targetPage === 1) targetScrollTop = 0;
            
            state.currentFront.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth',
            });
            
            state.currentFront.addEventListener('scrollend', () => {
                updateState({ ignoreScrollEvents: false });
            }, { once: true });
        }
    }
}

export async function renderDocumentToLayer(pdfDocument, targetLayer, pageToAnchor = null) {
    targetLayer.innerHTML = '';
    const targetWidth = targetLayer.clientWidth * 0.9;
    let targetAnchorCanvas = null;

    const pagePromises = [];
    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        pagePromises.push(pdfDocument.getPage(pageNum));
    }

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pagePromises[pageNum - 1];
        const unscaledViewport = page.getViewport({ scale: 1.0 });

        let finalScale = 1.0;
        if (state.currentZoomMode === 'fit-width') {
            finalScale = targetWidth / unscaledViewport.width;
        } else if (state.currentZoomMode === 'fit-height') {
            finalScale = (targetLayer.clientHeight - 88) / unscaledViewport.height;
        } else {
            finalScale = parseFloat(state.currentZoomMode) * (96 / 72) * (1 / 1.18);
        }
        finalScale = Math.min(Math.max(finalScale, 0.1), 5.0);

        const viewport = page.getViewport({ scale: finalScale });

        const pageContainer = document.createElement('div');
        pageContainer.className = 'page-container';
        pageContainer.dataset.pageNumber = pageNum;
        pageContainer.style.width = Math.floor(viewport.width) + 'px';
        pageContainer.style.height = Math.floor(viewport.height) + 'px';

        if (pageNum === pageToAnchor) {
            targetAnchorCanvas = pageContainer;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const outputScale = window.devicePixelRatio || 1;

        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        pageContainer.appendChild(canvas);
        targetLayer.appendChild(pageContainer);

        (async () => {
            try {
                const renderContext = { canvasContext: context, transform, viewport };
                await page.render(renderContext).promise;

                const textLayerDiv = document.createElement('div');
                textLayerDiv.className = 'textLayer';
                textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
                pageContainer.appendChild(textLayerDiv);

                const textContent = await page.getTextContent();
                const textLayer = new pdfjsLib.TextLayer({
                    textContentSource: textContent,
                    container: textLayerDiv,
                    viewport: viewport
                });
                await textLayer.render();

                const annotationLayerDiv = document.createElement('div');
                annotationLayerDiv.className = 'annotationLayer';
                annotationLayerDiv.style.setProperty('--scale-factor', viewport.scale);
                pageContainer.appendChild(annotationLayerDiv);

                const annotations = await page.getAnnotations();
                const annotationLayer = new pdfjsLib.AnnotationLayer({
                    div: annotationLayerDiv,
                    accessibilityManager: null,
                    annotationCanvasMap: null,
                    annotationEditorUIManager: null,
                    page: page,
                    viewport: viewport,
                    structTreeLayer: null
                });

                await annotationLayer.render({
                    viewport: viewport,
                    div: annotationLayerDiv,
                    annotations: annotations,
                    page: page,
                    linkService: {
                        getDestinationHash: (dest) => dest,
                        getAnchorUrl: (href) => href || '',
                        setDocument: () => {},
                        executeNamedAction: () => {},
                        cachePageRef: () => {},
                        isPageVisible: () => true,
                        isPageCached: () => true,
                        addLinkAttributes: (link, url) => { link.href = url; },
                        goToDestination: (dest) => {
                            if (typeof dest === 'string') {
                                pdfDocument.getDestination(dest).then(explicitDest => {
                                    if (Array.isArray(explicitDest) && explicitDest.length > 0) {
                                        const ref = explicitDest[0];
                                        pdfDocument.getPageIndex(ref).then(pageIndex => {
                                            jumpToPage(pageIndex + 1);
                                        }).catch(() => {});
                                    }
                                });
                            } else if (Array.isArray(dest) && dest.length > 0) {
                                const ref = dest[0];
                                pdfDocument.getPageIndex(ref).then(pageIndex => {
                                    jumpToPage(pageIndex + 1);
                                }).catch(() => {});
                            }
                        }
                    },
                    downloadManager: null,
                    renderForms: false
                });

                annotationLayerDiv.addEventListener('click', function(event) {
                    const target = event.target.closest('a');
                    if (!target) return;
                    
                    const href = target.getAttribute('href');
                    if (href && href.startsWith('#')) {
                        event.preventDefault();

                        let targetPageNum;

                        const explicitPageMatch = href.match(/page=(\d+)/);
                        if (explicitPageMatch) {
                            targetPageNum = parseInt(explicitPageMatch[1], 10);
                        } else {
                            try {
                                let parsed = JSON.parse(decodeURIComponent(href.substring(1)));
                                if (Array.isArray(parsed) && parsed.length > 0) {
                                    const ref = parsed[0];
                                    pdfDocument.getPageIndex(ref).then((pageIndex) => {
                                        jumpToPage(pageIndex + 1);
                                    }).catch(() => {});
                                    return; 
                                }
                            } catch {
                                // ignore
                            }
                        }

                        if (targetPageNum) {
                            jumpToPage(targetPageNum);
                        }
                    }
                });
            } catch (err) {
                console.warn('Background rendering failed:', err);
            }
        })();
    }

    return targetAnchorCanvas;
}
