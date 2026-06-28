chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_pin') {
        fetch(request.url, { method: 'HEAD' })
            .then(res => {
                if (!res.ok && res.status === 403) {
                    sendResponse({ success: false, fallback: true });
                    return;
                }
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
            })
            .catch(err => {
                // If fetch fails (e.g. network error), still try to download via Chrome
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
            });
        return true; // Indicates we will respond asynchronously
    }
});
