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
    } else if (request.action === 'download_hls') {
        const { m3u8_url, filename } = request;

        const downloadHLS = async () => {
            try {
                // Step 1: Fetch the master/media playlist
                const playlistRes = await fetch(m3u8_url);
                if (!playlistRes.ok) return { success: false, error: `Playlist fetch failed: ${playlistRes.status}` };
                const playlistText = await playlistRes.text();

                let mediaPlaylistUrl = m3u8_url;
                let mediaPlaylistText = playlistText;

                // Step 2: If this is a master playlist, find the highest bandwidth variant
                if (playlistText.includes('#EXT-X-STREAM-INF')) {
                    const lines = playlistText.split('\n');
                    let bestBandwidth = 0;
                    let bestUrl = null;
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line.startsWith('#EXT-X-STREAM-INF')) {
                            const bwMatch = line.match(/BANDWIDTH=(\d+)/);
                            const bandwidth = bwMatch ? parseInt(bwMatch[1]) : 0;
                            // Next non-comment line is the URL
                            for (let j = i + 1; j < lines.length; j++) {
                                const nextLine = lines[j].trim();
                                if (nextLine && !nextLine.startsWith('#')) {
                                    if (bandwidth > bestBandwidth) {
                                        bestBandwidth = bandwidth;
                                        bestUrl = nextLine;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                    if (bestUrl) {
                        // Resolve relative URL
                        const baseUrl = m3u8_url.substring(0, m3u8_url.lastIndexOf('/') + 1);
                        mediaPlaylistUrl = bestUrl.startsWith('http') ? bestUrl : baseUrl + bestUrl;
                        const mediaRes = await fetch(mediaPlaylistUrl);
                        if (!mediaRes.ok) return { success: false, error: `Media playlist fetch failed: ${mediaRes.status}` };
                        mediaPlaylistText = await mediaRes.text();
                    }
                }

                // Step 3: Extract .ts segment URLs from the media playlist
                const segmentUrls = [];
                const mediaBaseUrl = mediaPlaylistUrl.substring(0, mediaPlaylistUrl.lastIndexOf('/') + 1);
                for (const line of mediaPlaylistText.split('\n')) {
                    const trimmed = line.trim();
                    if (trimmed && !trimmed.startsWith('#')) {
                        const segUrl = trimmed.startsWith('http') ? trimmed : mediaBaseUrl + trimmed;
                        segmentUrls.push(segUrl);
                    }
                }

                if (segmentUrls.length === 0) {
                    return { success: false, error: 'No segments found in playlist' };
                }

                // Step 4: Download all segments
                const segmentBuffers = [];
                for (const segUrl of segmentUrls) {
                    const segRes = await fetch(segUrl);
                    if (!segRes.ok) return { success: false, error: `Segment fetch failed: ${segRes.status} for ${segUrl}` };
                    segmentBuffers.push(await segRes.arrayBuffer());
                }

                // Step 5: Concatenate all segments
                const totalSize = segmentBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
                const combined = new Uint8Array(totalSize);
                let offset = 0;
                for (const buf of segmentBuffers) {
                    combined.set(new Uint8Array(buf), offset);
                    offset += buf.byteLength;
                }

                // Step 6: Convert to base64 data URL and download
                // Process in chunks to avoid call stack overflow
                let binary = '';
                const chunkSize = 8192;
                for (let i = 0; i < combined.length; i += chunkSize) {
                    const chunk = combined.subarray(i, Math.min(i + chunkSize, combined.length));
                    binary += String.fromCharCode.apply(null, chunk);
                }
                const base64 = btoa(binary);
                const dataUrl = `data:video/mp2t;base64,${base64}`;

                return new Promise(resolve => {
                    chrome.downloads.download({
                        url: dataUrl,
                        filename: filename,
                        conflictAction: 'uniquify'
                    }, (downloadId) => {
                        if (chrome.runtime.lastError) {
                            resolve({ success: false, error: chrome.runtime.lastError.message });
                        } else {
                            resolve({ success: true, downloadId });
                        }
                    });
                });

            } catch (err) {
                return { success: false, error: err.toString() };
            }
        };

        downloadHLS().then(sendResponse);
        return true;
    }
});
