chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'download_pin') {
        const urlsToTry = request.urls || [request.url];

        const tryDownload = async () => {
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
    }
});
