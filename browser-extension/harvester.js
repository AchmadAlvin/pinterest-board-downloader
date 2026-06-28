// Continuous React Fiber Harvester (MAIN World)
window.__PBDL_PIN_CACHE = {};
window.__PBDL_VISITED = new Set();

function resolveRef(val, root_cache) {
    let current = val;
    let depth = 0;
    while (current && current.__ref && root_cache && root_cache[current.__ref] && depth < 5) {
        current = root_cache[current.__ref];
        depth++;
    }
    return current;
}

function extract_best_video(video_list, root_cache) {
    if (!video_list) return null;
    const preferred_qualities = ['V_1080P', 'V_720P', 'V_480P', 'V_240P', 'V_EXP7', 'V_EXP3', 'V_HLSV4_MAC', 'V_HLSV4_IOS'];
    for (const quality of preferred_qualities) {
        const qual_obj = resolveRef(video_list[quality], root_cache);
        if (qual_obj?.url) {
            let url = qual_obj.url;
            const clean = url.split('?')[0].split('#')[0].toLowerCase();
            if (!clean.endsWith('.m3u8') && !clean.endsWith('.xml') && !clean.endsWith('.mpd')) {
                return url;
            }
        }
    }
    for (const key of Object.keys(video_list)) {
        const qual_obj = resolveRef(video_list[key], root_cache);
        if (qual_obj?.url) {
            const clean = qual_obj.url.split('?')[0].split('#')[0].toLowerCase();
            if (!clean.endsWith('.m3u8') && !clean.endsWith('.xml') && !clean.endsWith('.mpd')) {
                return qual_obj.url;
            }
        }
    }
    // FALLBACK: If only .m3u8 is available, synthesize the .mp4 URL
    for (const key of Object.keys(video_list)) {
        const qual_obj = resolveRef(video_list[key], root_cache);
        if (qual_obj?.url) {
            const clean = qual_obj.url.split('?')[0].split('#')[0].toLowerCase();
            if (clean.endsWith('.m3u8')) {
                const base = qual_obj.url.replace('.m3u8', '.mp4');
                const name = base.split('/').pop().replace('.mp4', '');
                const base_1080w = base.replace(name + '.mp4', name + '_1080w.mp4');
                const base_720w = base.replace(name + '.mp4', name + '_720w.mp4');
                const base_480w = base.replace(name + '.mp4', name + '_480w.mp4');
                
                return `fallback||${base.replace('/hls/', '/1080p/')}||${base.replace('/hls/', '/720p/')}||${base.replace('/hls/', '/480p/')}||${base.replace('/hls/', '/360p/')}||${base.replace('/hls/', '/240p/')}||${base.replace('/hls/', '/orig/')}||${base.replace('/hls/', '/originals/')}||${base.replace('/hls/', '/')}||${base_1080w.replace('/hls/', '/1080p/')}||${base_720w.replace('/hls/', '/720p/')}||${base_480w.replace('/hls/', '/480p/')}||hls:${qual_obj.url}`;
            }
        }
    }
    return null;
}

function searchForPins(obj, depth = 0, root_cache = null) {
    if (depth > 15 || !obj || typeof obj !== 'object') return;
    if (obj instanceof Element || obj.$$typeof) return; 
    if (window.__PBDL_VISITED.has(obj)) return;
    window.__PBDL_VISITED.add(obj);
    
    let raw_id = obj.id || obj.pinId || obj.pin_id || obj.dbId;
    let pin_id = raw_id ? String(raw_id) : null;
    if (pin_id && pin_id.startsWith('UGlu')) {
        try {
            const decoded = atob(pin_id);
            if (decoded.startsWith('Pin:')) {
                pin_id = decoded.split(':')[1];
            }
        } catch(e) {}
    }
    
    if (pin_id && (obj.type === 'pin' || obj.__typename === 'Pin' || obj.story_pin_data || obj.videos || obj.video || obj.images || obj.image)) {
        let urls = [];
        
        const story_pin_data = resolveRef(obj.story_pin_data || obj.storyPinData, root_cache);
        const carousel_data = resolveRef(obj.carousel_data || obj.carouselData, root_cache);
        const videos = resolveRef(obj.videos || obj.video, root_cache);
        const video_urls = resolveRef(obj.video_urls || obj.videoUrls, root_cache);
        const images = resolveRef(obj.images || obj.image, root_cache);

        if (videos) {
            const vl = resolveRef(videos.video_list || videos.videoList, root_cache);
            const best_video = extract_best_video(vl, root_cache);
            if (best_video) urls.push(best_video);
        }
        
        if (urls.length === 0 && video_urls) {
            const vlist = Array.isArray(video_urls) ? video_urls : [video_urls];
            for (let v of vlist) {
                v = resolveRef(v, root_cache);
                if (typeof v === 'string') {
                    const clean = v.split('?')[0].split('#')[0].toLowerCase();
                    if (clean.endsWith('.m3u8')) {
                        const base = v.replace('.m3u8', '.mp4');
                        urls.push(`fallback||${base.replace('/hls/', '/1080p/')}||${base.replace('/hls/', '/720p/')}||${base.replace('/hls/', '/480p/')}||${base.replace('/hls/', '/360p/')}||${base.replace('/hls/', '/240p/')}||${base.replace('/hls/', '/orig/')}||${base.replace('/hls/', '/originals/')}||${base.replace('/hls/', '/')}||hls:${v}`);
                        break;
                    } else if (!clean.endsWith('.xml') && !clean.endsWith('.mpd')) {
                        urls.push(v);
                        break;
                    }
                }
            }
        }
        
        if (urls.length === 0 && story_pin_data) {
            const pages = resolveRef(story_pin_data.pages, root_cache);
            if (pages && Array.isArray(pages)) {
                for (let page of pages) {
                    let found_media = false;
                    
                    const page_video = resolveRef(page.video, root_cache);
                    if (page_video) {
                        const vl = resolveRef(page_video.video_list || page_video.videoList, root_cache);
                        const best_video = extract_best_video(vl, root_cache);
                        if (best_video) {
                            urls.push(best_video);
                            found_media = true;
                        }
                    }

                    if (!found_media) {
                        const blocks = resolveRef(page.blocks, root_cache);
                        if (blocks && Array.isArray(blocks)) {
                            for (let block of blocks) {
                                const b_video = resolveRef(block.video, root_cache);
                                if (b_video) {
                                    const vl = resolveRef(b_video.video_list || b_video.videoList, root_cache);
                                    const best_video = extract_best_video(vl, root_cache);
                                    if (best_video) {
                                        urls.push(best_video);
                                        found_media = true;
                                    }
                                } else if (block.type === 'story_pin_image_block') {
                                    const b_image = resolveRef(block.image, root_cache);
                                    const originals = b_image ? resolveRef(b_image.originals || b_image.orig, root_cache) : null;
                                    if (originals && originals.url) {
                                        urls.push(originals.url);
                                        found_media = true;
                                    }
                                }
                            }
                        }
                    }
                    if (!found_media) {
                        const page_image = resolveRef(page.image, root_cache);
                        const p_images = page_image ? resolveRef(page_image.images, root_cache) : null;
                        const originals = p_images ? resolveRef(p_images.originals || p_images.orig, root_cache) : null;
                        if (originals && originals.url) {
                            urls.push(originals.url);
                        }
                    }
                }
            }
        }
        
        if (urls.length === 0 && carousel_data) {
            const slots = resolveRef(carousel_data.carousel_slots || carousel_data.carouselSlots, root_cache);
            if (slots && Array.isArray(slots)) {
                for (let slot of slots) {
                    slot = resolveRef(slot, root_cache);
                    // Check for video in carousel slot first
                    const slot_video = resolveRef(slot.videos || slot.video, root_cache);
                    if (slot_video) {
                        const vl = resolveRef(slot_video.video_list || slot_video.videoList, root_cache);
                        const best = extract_best_video(vl, root_cache);
                        if (best) { urls.push(best); continue; }
                    }
                    // Fallback to image
                    const images = resolveRef(slot.images || slot.image, root_cache);
                    const originals = images ? resolveRef(images.originals || images.orig, root_cache) : null;
                    if (originals && originals.url) {
                        urls.push(originals.url);
                    }
                }
            }
        }
        
        if (urls.length === 0 && images) {
            const images_obj = resolveRef(images, root_cache);
            const originals = images_obj ? resolveRef(images_obj.originals || images_obj.orig, root_cache) : null;
            if (originals?.url) {
                urls.push(originals.url);
            }
        }
        
        if (urls.length > 0) {
            window.__PBDL_PIN_CACHE[pin_id] = urls;
        }
    }
    
    if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) {
            searchForPins(obj[i], depth + 1, root_cache);
        }
    } else {
        for (let key of Object.keys(obj)) {
            if (key.startsWith('__')) continue;
            searchForPins(obj[key], depth + 1, root_cache);
        }
    }
}

if (!window.__PBDL_HARVESTER) {
    window.__PBDL_HARVESTER = setInterval(() => {
        try {
            // Periodically check global caches
            let rc = null;
            if (window.__APOLLO_CLIENT__) {
                rc = window.__APOLLO_CLIENT__.cache.extract();
                searchForPins(rc, 0, rc);
            }
            if (window.__PWS_DATA__) searchForPins(window.__PWS_DATA__);
            if (window.__PWS_INITIAL_PROPS__) searchForPins(window.__PWS_INITIAL_PROPS__);
            
            // Periodically harvest from React Fiber for pins currently in the DOM
            const pinElements = document.querySelectorAll('[data-test-id="pin"], a[href^="/pin/"]');
            pinElements.forEach(el => {
                const reactKeys = Object.keys(el).filter(key => key.startsWith('__reactFiber$'));
                if (reactKeys.length > 0) {
                    let curr = el[reactKeys[0]];
                    let limit = 250; // Fast upward traversal for each pin
                    while (curr && limit > 0) {
                        limit--;
                        if (curr.memoizedProps) {
                            searchForPins(curr.memoizedProps);
                        }
                        curr = curr.return;
                    }
                }
            });
            
            // Keep the visited set from growing forever
            if (window.__PBDL_VISITED.size > 20000) window.__PBDL_VISITED.clear();
        } catch(e) {}
    }, 150);
}

window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'PINTEREST_REQUEST_DATA') {
        window.postMessage({ type: 'PINTEREST_STORE_DATA', payload: window.__PBDL_PIN_CACHE }, '*');
    }
});
