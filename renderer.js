import * as pdfjsLib from './public/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = './public/pdf.worker.mjs';

const messageOverlay = document.getElementById('message-overlay');
const container = document.getElementById('container');
const messageText = document.getElementById('message-text');
const openFileBtn = document.getElementById('open-file-btn');
const pdfControls = document.getElementById('pdf-controls');
const zoomSelect = document.getElementById('zoom-select');
const pageInput = document.getElementById('page-input');
const pageCountText = document.getElementById('page-count-text');
const closeBtn = document.getElementById('close-btn');
const appTitleText = document.getElementById('app-title-text');

function updateWindowTitle(filePath) {
    if (!appTitleText) return;
    if (filePath) {
        const fileName = filePath.split(/[/\\]/).pop();
        appTitleText.textContent = `Smooth PDF - ${fileName}`;
    } else {
        appTitleText.textContent = 'Smooth PDF';
    }
}

let currentFront = document.getElementById('layer-1');
let currentBack = document.getElementById('layer-2');

let currentPdfPath = null;
let isRendering = false;
let pendingRender = false;

let currentZoomMode = 'fit-width';
let totalPages = 0;
let currentPageNumber = 1;
let pageObserver = null;
let ignoreScrollEvents = false;

async function init() {
    try {
        currentPdfPath = await window.api.getFilePath();
        if (currentPdfPath) {
            updateWindowTitle(currentPdfPath);
            await loadAndRenderPdf(currentPdfPath);
        } else {
            showMessage('No PDF loaded. Click \'Open PDF\' to begin.');
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
        console.error('Init Error:', err);
        showMessage('Application Init Failed');
    }
}

function showMessage(msg) {
    messageText.textContent = msg;
    messageOverlay.classList.remove('hidden');
    container.classList.add('hidden');
}

function hideMessage() {
    messageOverlay.classList.add('hidden');
    container.classList.remove('hidden');
}

async function loadPdfDocument(filePath) {
    const loadingTask = pdfjsLib.getDocument(`safe-file://${encodeURIComponent(filePath)}`);
    return await loadingTask.promise;
}

async function renderDocumentToLayer(
    pdfDocument,
    targetLayer,
    pageToAnchor = null,
) {
    targetLayer.innerHTML = '';

    const targetWidth = targetLayer.clientWidth * 0.9;

    let targetAnchorCanvas = null;

    for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1.0 });

        let finalScale = 1.0;
        if (currentZoomMode === 'fit-width') {
            finalScale = targetWidth / unscaledViewport.width;
        } else if (currentZoomMode === 'fit-height') {
            finalScale = (targetLayer.clientHeight - 88) / unscaledViewport.height;
        } else {
            finalScale = parseFloat(currentZoomMode) * (96 / 72) * (1 / 1.18);
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

        const transform =
      outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

        pageContainer.appendChild(canvas);
        targetLayer.appendChild(pageContainer);

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
                        // ignore parsing error
                    }
                }

                if (targetPageNum) {
                    jumpToPage(targetPageNum);
                }
            }
        });
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
            rootMargin: '-50% 0px -50% 0px',
            threshold: 0,
        },
    );

    const containers = layerElement.querySelectorAll('.page-container');
    containers.forEach((c) => pageObserver.observe(c));
}

function updateControlsUI() {
    if (pageCountText) pageCountText.textContent = `/ ${totalPages}`;
    if (zoomSelect) {
        zoomSelect.value = currentZoomMode;
    }
}

async function loadAndRenderPdf(filePath) {
    isRendering = true;
    try {
        const doc = await loadPdfDocument(filePath);
        totalPages = doc.numPages;
        updateControlsUI();
        pdfControls.classList.remove('hidden');

        await renderDocumentToLayer(doc, currentFront);
        setupPageObserver(currentFront);
        hideMessage();
    } catch (err) {
        console.error(err);
        showMessage('Failed to load initial PDF');
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

        const anchorCanvas = await renderDocumentToLayer(
            doc,
            currentBack,
            anchorPage,
        );
        if (anchorCanvas) {
            if (anchorPage === 1) {
                currentBack.scrollTop = 0;
            } else {
                currentBack.scrollTop = anchorCanvas.offsetTop - 64;
            }
        } else {
            currentBack.scrollTop = currentScrollPos;
        }

        currentBack.style.transition = 'none';
        currentBack.classList.remove('hidden');
        void currentBack.offsetWidth;
        currentBack.style.transition = '';

        currentFront.classList.add('hidden');

        await new Promise((resolve) => {
            const handler = () => {
                clearTimeout(fallback);
                resolve();
            };
            const fallback = setTimeout(() => {
                currentFront.removeEventListener('transitionend', handler);
                resolve();
            }, 600);
            currentFront.addEventListener('transitionend', handler, { once: true });
        });

        currentBack.classList.add('is-front');
        currentBack.classList.remove('is-back');
        currentFront.classList.add('is-back');
        currentFront.classList.remove('is-front');

        currentFront.innerHTML = '';
        setupPageObserver(currentBack);

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
window.addEventListener('resize', () => {
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

window.addEventListener('keydown', (e) => {
    if (!currentPdfPath) return;

    if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+' || e.key === '-')) {
        e.preventDefault();
        let newZoomMode = currentZoomMode;

        if (currentZoomMode === 'fit-width' || currentZoomMode === 'fit-height') {
            newZoomMode = '1';
        } else {
            const zoomLevels = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
            const currentZoomFloat = parseFloat(currentZoomMode);
            const currentIndex = zoomLevels.findIndex((z) => Math.abs(z - currentZoomFloat) < 0.01);
            
            if (currentIndex === -1) {
                newZoomMode = '1';
            } else {
                if (e.key === '-' && currentIndex > 0) {
                    newZoomMode = zoomLevels[currentIndex - 1].toString();
                } else if ((e.key === '=' || e.key === '+') && currentIndex < zoomLevels.length - 1) {
                    newZoomMode = zoomLevels[currentIndex + 1].toString();
                }
            }
        }

        if (newZoomMode !== currentZoomMode) {
            currentZoomMode = newZoomMode;
            updateControlsUI();
            
            if (isRendering) {
                pendingRender = true;
            } else {
                performCrossfadeUpdate(currentPdfPath, currentPageNumber);
            }
        }
    }
});

if (zoomSelect) {
    zoomSelect.addEventListener('change', (e) => {
        if (!currentPdfPath) {
            e.target.value = currentZoomMode;
            return;
        }
        currentZoomMode = e.target.value;
        updateControlsUI();
        if (isRendering) {
            pendingRender = true;
        } else {
            performCrossfadeUpdate(currentPdfPath, currentPageNumber);
        }
    });
}

if (pageInput) {
    pageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            jumpToPage(pageInput.value);
            pageInput.blur();
        }
    });

    pageInput.addEventListener('blur', () => {
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
        const targetContainer = currentFront.querySelector(
            `.page-container[data-page-number="${targetPage}"]`,
        );
        if (targetContainer) {
            ignoreScrollEvents = true;
            let targetScrollTop = targetContainer.offsetTop - 64;
            if (targetPage === 1) targetScrollTop = 0;
            
            currentFront.scrollTo({
                top: targetScrollTop,
                behavior: 'smooth',
            });
            setTimeout(() => {
                ignoreScrollEvents = false;
            }, 500);
        }
    }
}

closeBtn.addEventListener('click', async () => {
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

        currentFront.innerHTML = '';
        currentBack.innerHTML = '';

        pdfControls.classList.add('hidden');
        updateWindowTitle(null);

        openFileBtn.classList.remove('hidden');
        document.getElementById('welcome-icon').classList.remove('hidden');

        showMessage('No PDF loaded. Click \'Open PDF\' to begin.');
    } catch (err) {
        console.error('Error closing file:', err);
    }
}

openFileBtn.addEventListener('click', async () => {
    try {
        const filePath = await window.api.selectFile();
        if (filePath) {
            currentPdfPath = filePath;
            updateWindowTitle(currentPdfPath);
            openFileBtn.classList.add('hidden');
            document.getElementById('welcome-icon').classList.add('hidden');
            showMessage('Loading your beautiful PDF...');
            await loadAndRenderPdf(currentPdfPath);
        }
    } catch (err) {
        console.error('Error opening file:', err);
    }
});

window.addEventListener('contextmenu', (e) => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim() !== '') {
        e.preventDefault();
        window.api.showContextMenu();
    }
});

init();
