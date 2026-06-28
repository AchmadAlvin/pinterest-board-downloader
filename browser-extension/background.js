chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_pin') {
        const urlsToTry = request.urls || [request.url];

        const tryDownload = async () => {
            // FAST PATH: If there's only 1 URL, it's a native URL from the API. 
            // DO NOT probe it, because background worker fetch probes often get 403'd by AWS WAF due to missing headers!
            if (urlsToTry.length === 1) {
                return new Promise(resolve => {
                    try {
                        chrome.downloads.download({
                            url: urlsToTry[0],
                            filename: request.filename,
                            conflictAction: 'uniquify'
                        }, (downloadId) => {
                            if (chrome.runtime.lastError) {
                                resolve({ success: false, error: chrome.runtime.lastError.message });
                            } else {
                                resolve({ success: true, downloadId: downloadId });
                            }
                        });
                    } catch (e) {
                        resolve({ success: false, error: e.toString() });
                    }
                });
            }

            for (const url of urlsToTry) {
                try {
                    const controller = new AbortController();
                    const res = await fetch(url, { method: 'GET', signal: controller.signal });
                    const isOk = res.ok;
                    controller.abort(); // Immediately cancel download after receiving headers
                    
                    if (isOk) {
                        return new Promise(resolve => {
                            chrome.downloads.download({
                                url: url,
                                filename: request.filename,
                                conflictAction: 'uniquify'
                            }, (downloadId) => {
                                if (chrome.runtime.lastError) {
                                    resolve({ success: false, error: chrome.runtime.lastError.message });
                                } else {
                                    resolve({ success: true, downloadId: downloadId });
                                }
                            });
                        });
                    }
                } catch (err) {
                    // Network error with this URL, try the next one
                    continue;
                }
            }
            // If all URLs returned 403 or failed
            return { success: false, fallback: true };
        };

        tryDownload().then(sendResponse);
        return true; // Indicates we will respond asynchronously
    } else if (request.action === "download_and_probe") {
        const { url, filename } = request;
        try {
            chrome.downloads.download({ url: url, filename: filename, conflictAction: 'uniquify' }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ success: false, error: chrome.runtime.lastError.message });
                    return;
                }

                const listener = (delta) => {
                    if (delta.id === downloadId) {
                        if (delta.mime && delta.mime.current) {
                            const mime = delta.mime.current.toLowerCase();
                            if (mime.includes('xml') || mime.includes('html') || mime.includes('text')) {
                                // 403 error page disguised as a download
                                chrome.downloads.cancel(downloadId, () => {
                                    chrome.downloads.erase({ id: downloadId });
                                });
                                chrome.downloads.onChanged.removeListener(listener);
                                sendResponse({ success: false, reason: 'invalid_mime' });
                            } else {
                                // Valid media file! Let it continue downloading
                                chrome.downloads.onChanged.removeListener(listener);
                                sendResponse({ success: true });
                            }
                        } else if (delta.state && delta.state.current === 'complete') {
                            chrome.downloads.onChanged.removeListener(listener);
                            sendResponse({ success: true });
                        } else if (delta.state && delta.state.current === 'interrupted') {
                            chrome.downloads.erase({ id: downloadId });
                            chrome.downloads.onChanged.removeListener(listener);
                            sendResponse({ success: false, reason: 'interrupted' });
                        }
                    }
                };
                chrome.downloads.onChanged.addListener(listener);
            });
        } catch (e) {
            sendResponse({ success: false, error: e.toString() });
        }
        return true;
    }
});
