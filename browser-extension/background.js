chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_pin') {
        chrome.downloads.download({
            url: request.url,
            filename: request.filename,
            conflictAction: 'uniquify'
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                sendResponse({ success: true, downloadId: downloadId });
            }
        });
        return true; // Indicates we will respond asynchronously
    }
});
