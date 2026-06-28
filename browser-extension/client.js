// Working (marquee fix)
let selected_pins = new Map();
let observer_running = false;
let observer;
let last_pin_received_time = 0;
let last_pin_received_cut_off_duration_ms = (1_000 * 60); // INCREASED to 60s for large boards
let timeout_watcher_interval = null;
let auto_scroll_interval = null;
let cancel_downloads = false;
let stateful_mode = true;
let MAX_CONCURRENT_DOWNLOADS = 10;
let downloaded_pins = new Set();
let downloaded_media_urls = new Set();
let failed_pins = new Set();

// Endless Mode Variables
let endless_mode_active = false;
let endless_batch_size = 100; // Download every N pins
let endless_total_downloaded = 0;
let endless_is_downloading = false; // Guard to prevent overlapping batch triggers

// Memory Cache
let memory_cached_pins = {};

// Marquee Variables
let is_marquee_selecting = false;
let start_marquee_x = 0;
let start_marquee_y = 0;
let current_marquee_x = 0;
let current_marquee_y = 0;
let marquee_div = null;
let did_marquee_drag = false;
let marquee_raf = null;

let current_board_url = '';
let url_change_observer = null;
let is_on_board_page = false;

let DOM_template = {
    downloader_button: { self: null },
    full_ui_wrapper: {
        self: null,
        selected_pins_wrapper: {
            self: null,
            currently_selected_pins_count_elem: { self: null },
            start_download_btn: { self: null }
        },
        board_count_wrapper: {
            self: null,
            current_board_count_elem: { self: null },
            start_download_btn: { self: null }
        },
        select_visible_pins_elem: { self: null },
        progress_log_elem: { self: null },
        close_ui_elem: { self: null }
    },
    overlay_elem: { self: null }
}; let DOM = DOM_template;

let message_template = {
    clear: 'No logs to view right now.',
    selection_success: 'Successfully selected pins',
    select_error: 'No pins selected. Select pins & try again',
    extraction_progress: 'Extracting pin URLs',
    video_extraction_progress: 'Extracting video URLs',
    board_count_error: 'Board pin count Not Available',
    board_no_pins: 'No board pins found for this board',
    extraction_error: 'Failed to extract all pins...',
    extraction_error_2: 'Pin extraction stopped: No new pins received',
    extraction_success: 'Successfully extracted all pin URLs!',
    download_progress: 'Downloading pins',
    download_error: 'ERROR: Failed to download all pins...',
    download_success: 'Successfully downloaded pins!',
    waiting_for_pins: 'Waiting for new pins...',
    endless_active: 'Endless Mode Active: Scraping & Downloading...',
    endless_batch_done: 'Batch downloaded. Resuming search...',
    endless_stop: 'Endless Mode Stopped.'
};

const progress_logs = ['cc_log', 'cc_warning', 'cc_error', 'cc_success'];
function logger(level, message, context = {}) {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const logMessage = `[PBDL - ${timestamp}] [${level}] ${message}`;
    const contextString = Object.keys(context).length > 0 ? JSON.stringify(context) : '';

    switch (level) {
        case 'ERROR': console.error(logMessage, contextString); break;
        case 'WARN': console.warn(logMessage, contextString); break;
        case 'DEBUG': console.debug(logMessage, contextString); break;
        default: console.log(logMessage, contextString);
    }
}

if (document.readyState === 'interactive' || document.readyState === 'complete') initialize();
else window.addEventListener('DOMContentLoaded', initialize);

function inject_global_styles() {
    const style = document.createElement('style');
    style.id = 'pbdl-global-styles';
    style.innerHTML = `
        :root {
            --cc_fg_main: #333333;
            --cc_fg_sec: #555555;
            --cc_fg_tert: #aaaaaa;
            --cc_bg_main: #FFFFFF;
            --cc_border: #E0E0E0;
            --cc_accent_1: #007BFF;
            --cc_accent_2: #0056b3;
            --cc_bg_accent_2: rgba(0, 123, 255, 0.4);
            --cc_success: #34c556;
            --cc_bg_accent_success: rgba(52, 197, 86, 0.45);
            --cc_warning: #E8A600;
            --cc_bg_accent_warning: rgba(232, 166, 0, 0.4);
            --cc_error: #dc3545;
            --cc_fz_9px: clamp(10px, 0.468vw, 12px);
            --cc_fz_12px: clamp(12px, 0.625vw, 15px);
            --cc_fz_16px: clamp(14px, 0.833vw, 18px);
            --cc_fz_24px: clamp(20px, 1.25vw, 28px);
            --cc_fz_40px: clamp(32px, 2.083vw, 48px);
        }[data-test-id="pin"] a[href*="/pin/"]:focus-visible {
            outline: none !important;
        }
        a[data-stateful] { 
            cursor: pointer; 
            text-decoration: none; 
            font-weight: bold; 
        }
        a[data-stateful="true"] { 
            color: var(--cc_fg_main) !important; 
        }
        a[data-stateful="false"] { 
            color: var(--cc_fg_tert) !important; 
        }`;

    if (!document.getElementById(style.id)) {
        document.head.appendChild(style);
        logger('INFO', 'Global CSS variables injected.');
    }
}



async function initialize() {
    logger('INFO', 'Pinterest Board Downloader is activating...');
    inject_global_styles();

    const stored_pins = localStorage.getItem('downloaded_pins');
    if (stored_pins) {
        downloaded_pins = new Set(JSON.parse(stored_pins));
        logger('INFO', `Loaded ${downloaded_pins.size} previously downloaded pins from history.`);
    }

    const stored_media = localStorage.getItem('downloaded_media_urls');
    if (stored_media) {
        downloaded_media_urls = new Set(JSON.parse(stored_media));
    }

    setup_url_change_detection();
    let downloader_button = html_to_element(`<div id="cc_enable_downloader">
    <style>
        div#cc_enable_downloader {
            box-sizing: border-box;
            display: flex; align-items: center; justify-content: center;
            width: 44px !important;
            height: 44px !important;
            background: rgba(235, 235, 235, 0.7);
            backdrop-filter: blur(20px) saturate(200%) brightness(1.1);
            -webkit-backdrop-filter: blur(20px) saturate(200%) brightness(1.1);
            border: 1px solid var(--cc_fg_tert);
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
            position: fixed; right: 24px; bottom: 24px;
            border-radius: 12px; cursor: pointer; z-index: 999999;
            overflow: hidden;
            transition: transform 0.1s ease, border-color 0.1s ease;
        }
        div#cc_enable_downloader > * { position: relative; z-index: 1; }
        div#cc_enable_downloader:hover { border-color: var(--cc_accent_1); transform: scale(1.05); }
        div#cc_enable_downloader h2 { display: none; }
        div#cc_enable_downloader svg { width: 22px; height: 22px; }
        .cc_hidden { visibility: hidden !important; }
    </style>
    <svg style="display:block;flex-shrink:0;" viewBox="0 0 12 13" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip_launcher)"><rect y="0.5" width="12" height="12" rx="6" fill="#E9E9E9"/><path d="M3.77 12.075C3.70334 11.3917 3.74667 10.7367 3.9 10.11L4.5 7.52C4.38997 7.18576 4.33097 6.83684 4.325 6.485C4.325 5.645 4.73 5.045 5.37 5.045C5.81 5.045 6.135 5.355 6.135 5.945C6.135 6.135 6.09667 6.34833 6.02 6.585L5.76 7.445C5.71 7.61167 5.685 7.765 5.685 7.905C5.685 8.505 6.14 8.84 6.725 8.84C7.77 8.84 8.51 7.76 8.51 6.36C8.51 4.8 7.49 3.8 5.985 3.8C4.305 3.8 3.24 4.895 3.24 6.42C3.24 7.03 3.43 7.6 3.795 7.99C3.675 8.195 3.545 8.23 3.355 8.23C2.755 8.23 2.185 7.385 2.185 6.23C2.185 4.23 3.785 2.645 6.025 2.645C8.375 2.645 9.855 4.29 9.855 6.31C9.855 8.33 8.415 9.885 6.865 9.885C6.57003 9.88889 6.27821 9.82405 6.01265 9.69561C5.74709 9.56717 5.51508 9.37865 5.335 9.145L5.025 10.395C4.86976 11.0511 4.5952 11.6732 4.215 12.23C5.11334 12.5122 6.06554 12.5786 6.99435 12.4239C7.92316 12.2691 8.8024 11.8976 9.56075 11.3394C10.3191 10.7813 10.9352 10.0522 11.359 9.21135C11.7828 8.37051 12.0024 7.44161 12 6.5C12 4.9087 11.3679 3.38258 10.2426 2.25736C9.11742 1.13214 7.5913 0.5 6 0.5C4.4087 0.5 2.88258 1.13214 1.75736 2.25736C0.632143 3.38258 1.92232e-06 4.9087 1.92232e-06 6.5C-0.00095816 7.69967 0.35773 8.87208 1.02975 9.86585C1.70177 10.8596 2.65627 11.6291 3.77 12.075Z" fill="#BD081C"/></g><defs><clipPath id="clip_launcher"><rect y="0.5" width="12" height="12" rx="6" fill="white"/></clipPath></defs></svg>
</div>`);
    downloader_button.addEventListener('click', initialize_full_ui);
    document.body.appendChild(downloader_button);
    DOM.downloader_button.self = downloader_button;
    logger('INFO', 'Downloader is ready. Click the button to open the main UI.');
}

function initialize_full_ui() {
    logger('INFO', 'Opening the downloader user interface...');
    cancel_downloads = false;
    failed_pins.clear();

    // Check if we're on a board page
    is_on_board_page = check_if_board_page();

    let full_ui_wrapper_elem = html_to_element(`<div id="cc_full_ui_wrapper">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        div#cc_full_ui_wrapper, div#cc_full_ui_wrapper *, div#cc_full_ui_wrapper *::before, div#cc_full_ui_wrapper *::after { box-sizing: border-box; margin: 0; padding: 0; transition: all 120ms cubic-bezier(0.2, 0.8, 0.2, 1); user-select: none; }
        div#cc_full_ui_wrapper {
            background: rgba(235, 235, 235, 0.6);
            backdrop-filter: blur(60px) saturate(200%) brightness(1.1);
            -webkit-backdrop-filter: blur(60px) saturate(200%) brightness(1.1);
            border: 1px solid var(--cc_fg_tert);
            box-shadow: 0 -8px 32px rgba(0,0,0,0.12);
            color: transparent;
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px; font-weight: 500;
            width: 400px !important;
            max-width: calc(100vw - 48px);
            inline-size: unset;
            position: fixed !important; bottom: 24px !important;
            right: 24px !important;
            border-radius: 16px; overflow: hidden; z-index: 999999;
        }
        div#cc_full_ui_wrapper > * { position: relative; z-index: 1; }
        div#cc_full_ui_wrapper a { cursor: pointer; text-decoration: none; }
        div#cc_full_ui_wrapper a:hover { filter: brightness(0.8); }
        div#cc_full_ui_wrapper a:active { transform: scale(0.97); }

        /* HEADER */
        div#cc_full_ui_wrapper #cc_header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 16px; border-bottom: 1px solid rgba(0,0,0,0.08);
            cursor: pointer;
        }
        div#cc_full_ui_wrapper #cc_branding { display: flex; align-items: center; gap: 8px; }
        div#cc_full_ui_wrapper #cc_branding_name { font-size: 13px; font-weight: 600; color: var(--cc_fg_main); }
        div#cc_full_ui_wrapper #cc_header_controls { display: flex; align-items: center; gap: 12px; }
        div#cc_full_ui_wrapper #cc_minimize_btn, div#cc_full_ui_wrapper #cc_close_btn {
            color: var(--cc_fg_tert); cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;
        }

        div#cc_full_ui_wrapper #cc_minimize_btn:hover { color: var(--cc_fg_main); }
        div#cc_full_ui_wrapper #cc_close_btn:hover { color: var(--cc_error); }

        /* CONTROLS */
        div#cc_full_ui_wrapper #cc_controls_wrapper {
            display: flex; align-items: center; justify-content: space-around;
            padding: 14px 16px; gap: 8px;
        }
        div#cc_full_ui_wrapper .cc_single_control_wrapper {
            display: flex; flex: 1; flex-direction: column; align-items: center; text-align: center;
        }
        div#cc_full_ui_wrapper .cc_count_display {
            font-size: 28px; font-weight: 600; color: var(--cc_fg_main); line-height: 1;
        }
        div#cc_full_ui_wrapper .cc_count_label {
            font-size: 10px; font-weight: 600; color: var(--cc_fg_sec); margin-top: 3px; letter-spacing: 0.02em;
        }
        div#cc_full_ui_wrapper .cc_download_btn {
            font-size: 11px; font-weight: 600; color: var(--cc_accent_1) !important;
            margin-top: 5px; display: block;
        }
        div#cc_full_ui_wrapper #cc_select_all_visible_pins_elem {
            font-size: 13px; font-weight: 600; color: var(--cc_accent_1); cursor: pointer;
        }
        div#cc_full_ui_wrapper .cc_v_separator {
            background-color: rgba(0,0,0,0.08); block-size: 40px; inline-size: 1px; flex-shrink: 0;
        }

        /* LOG */
        div#cc_full_ui_wrapper #cc_section_2 {
            background: rgba(0,0,0,0.04);
            border-top: 1px solid rgba(0,0,0,0.08);
            padding: 8px 16px;
        }
        div#cc_full_ui_wrapper #cc_progress_log_elem {
            font-size: 11px; font-weight: 600; color: var(--cc_fg_sec); line-height: 1.4;
            -webkit-line-clamp: 2; -webkit-box-orient: vertical;
            display: -webkit-box; overflow: hidden; text-overflow: ellipsis; min-height: 1.4em;
        }

        /* FOOTER */
        div#cc_full_ui_wrapper #cc_section_3 {
            display: flex; align-items: center; justify-content: space-between;
            padding: 7px 16px; border-top: 1px solid rgba(0,0,0,0.08);
            background: rgba(0,0,0,0.04);
        }
        div#cc_full_ui_wrapper #cc_section_3 a {
            font-size: 10px; font-weight: 500; color: var(--cc_fg_sec);
        }
        div#cc_full_ui_wrapper #cc_section_3 a:hover { color: var(--cc_fg_main); }
        div#cc_full_ui_wrapper #cc_history_controls { display: flex; gap: 12px; align-items: center; }
        div#cc_full_ui_wrapper #cc_stateful_btn[data-stateful="false"] { color: var(--cc_fg_tert) !important; }

        /* ENDLESS */
        a#cc_endless_btn { color: var(--cc_fg_sec) !important; }
        a#cc_endless_btn[data-active="true"] {
            color: #fff !important; background-color: var(--cc_error);
            padding: 2px 7px; border-radius: 4px;
        }

        /* LOG COLORS */
        .cc_log { color: var(--cc_fg_main) !important; }
        .cc_warning { color: var(--cc_warning) !important; }
        .cc_error { color: var(--cc_error) !important; }
        .cc_success { color: var(--cc_success) !important; }
        .cc_visible { visibility: visible !important; }
        .cc_hidden { visibility: hidden !important; }
        div#cc_full_ui_wrapper #cc_progress_log_elem.cc_countdown { animation: pulse 1s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }

        /* MINIMIZED */
        div#cc_full_ui_wrapper.cc_minimized { 
            width: 44px !important; 
            height: 44px !important; 
            border-radius: 12px;
            cursor: pointer;
        }
        div#cc_full_ui_wrapper.cc_minimized #cc_header,
        div#cc_full_ui_wrapper.cc_minimized #cc_controls_wrapper,
        div#cc_full_ui_wrapper.cc_minimized #cc_section_2,
        div#cc_full_ui_wrapper.cc_minimized #cc_section_3 { 
            display: none !important; 
        }
        div#cc_full_ui_wrapper #cc_minimized_view {
            display: none;
        }
        div#cc_full_ui_wrapper.cc_minimized #cc_minimized_view {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%; height: 100%;
            position: relative;
        }
        div#cc_full_ui_wrapper #cc_minimized_summary_badge {
            position: absolute;
            top: -6px; right: -6px;
            background: var(--cc_accent_1);
            color: #fff;
            font-size: 9px;
            font-weight: bold;
            padding: 2px 5px;
            border-radius: 10px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            display: none;
        }

        @media (max-width: 520px) {
            div#cc_full_ui_wrapper:not(.cc_minimized) { width: calc(100vw - 48px) !important; }
        }

        /* HELP TOOLTIP */
        #cc_help_btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 15px; height: 15px; border-radius: 50%;
            background: rgba(0,0,0,0.10); color: var(--cc_fg_tert);
            font-size: 9px; font-weight: 700; cursor: pointer; flex-shrink: 0;
            font-family: 'Inter', sans-serif; line-height: 1;
            border: none; outline: none;
            transition: background 150ms ease, color 150ms ease;
        }
        #cc_help_btn:hover { background: var(--cc_accent_1); color: #fff; }
        #cc_help_tooltip {
            position: fixed;
            background: rgba(250, 250, 250, 0.96);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            color: var(--cc_fg_main);
            border: 1px solid var(--cc_border);
            border-radius: 10px;
            padding: 11px 13px;
            width: 226px;
            font-size: 11px;
            font-weight: 400;
            line-height: 1.55;
            pointer-events: none;
            z-index: 9999999;
            box-shadow: 0 8px 32px rgba(0,0,0,0.12);
            opacity: 0;
            transform-origin: bottom center;
        }
        #cc_help_tooltip::before {
            content: '';
            position: absolute;
            top: 100%; left: 44.5%; transform: translateX(-50%);
            border: 6px solid transparent;
            border-top-color: var(--cc_border);
        }
        #cc_help_tooltip::after {
            content: '';
            position: absolute;
            top: 100%; left: 44.5%; transform: translateX(-50%);
            border: 5px solid transparent;
            border-top-color: rgba(250, 250, 250, 0.96);
            margin-top: -1px;
        }
        #cc_help_tooltip .cc_tip_title {
            font-size: 11px; font-weight: 600; color: var(--cc_fg_main);
            margin-bottom: 7px; display: block;
        }
        #cc_help_tooltip .cc_tip_row {
            display: flex; align-items: flex-start; gap: 7px; margin-bottom: 5px;
        }
        #cc_help_tooltip .cc_tip_row:last-child { margin-bottom: 0; }
        #cc_help_tooltip .cc_tip_icon { flex-shrink: 0; font-size: 12px; line-height: 1.55; }
        #cc_help_tooltip .cc_tip_copy { color: var(--cc_fg_sec); }
        #cc_help_tooltip .cc_tip_copy strong { color: var(--cc_fg_main); font-weight: 600; }
        #cc_help_tooltip kbd {
            display: inline-block;
            font-family: 'Inter', monospace;
            font-size: 9px; font-weight: 600;
            background: rgba(0, 0, 0, 0.04);
            border: 1px solid var(--cc_border);
            border-radius: 3px;
            padding: 1px 4px;
            color: var(--cc_fg_main);
            vertical-align: 1px;
            line-height: 1.4;
        }
    </style>

    <div id="cc_header">
        <div id="cc_branding">
            <svg style="display:block;flex-shrink:0;" width="14" height="14" viewBox="0 0 12 13" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip_ui)"><rect y="0.5" width="12" height="12" rx="6" fill="#E9E9E9"/><path d="M3.77 12.075C3.70334 11.3917 3.74667 10.7367 3.9 10.11L4.5 7.52C4.38997 7.18576 4.33097 6.83684 4.325 6.485C4.325 5.645 4.73 5.045 5.37 5.045C5.81 5.045 6.135 5.355 6.135 5.945C6.135 6.135 6.09667 6.34833 6.02 6.585L5.76 7.445C5.71 7.61167 5.685 7.765 5.685 7.905C5.685 8.505 6.14 8.84 6.725 8.84C7.77 8.84 8.51 7.76 8.51 6.36C8.51 4.8 7.49 3.8 5.985 3.8C4.305 3.8 3.24 4.895 3.24 6.42C3.24 7.03 3.43 7.6 3.795 7.99C3.675 8.195 3.545 8.23 3.355 8.23C2.755 8.23 2.185 7.385 2.185 6.23C2.185 4.23 3.785 2.645 6.025 2.645C8.375 2.645 9.855 4.29 9.855 6.31C9.855 8.33 8.415 9.885 6.865 9.885C6.57003 9.88889 6.27821 9.82405 6.01265 9.69561C5.74709 9.56717 5.51508 9.37865 5.335 9.145L5.025 10.395C4.86976 11.0511 4.5952 11.6732 4.215 12.23C5.11334 12.5122 6.06554 12.5786 6.99435 12.4239C7.92316 12.2691 8.8024 11.8976 9.56075 11.3394C10.3191 10.7813 10.9352 10.0522 11.359 9.21135C11.7828 8.37051 12.0024 7.44161 12 6.5C12 4.9087 11.3679 3.38258 10.2426 2.25736C9.11742 1.13214 7.5913 0.5 6 0.5C4.4087 0.5 2.88258 1.13214 1.75736 2.25736C0.632143 3.38258 1.92232e-06 4.9087 1.92232e-06 6.5C-0.00095816 7.69967 0.35773 8.87208 1.02975 9.86585C1.70177 10.8596 2.65627 11.6291 3.77 12.075Z" fill="#BD081C"/></g><defs><clipPath id="clip_ui"><rect y="0.5" width="12" height="12" rx="6" fill="white"/></clipPath></defs></svg>
            <span id="cc_branding_name">Board Downloader</span>
        </div>
        <div id="cc_header_controls">

            <button id="cc_help_btn" aria-label="How to use">?</button>
            <svg id="cc_minimize_btn" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            <svg id="cc_close_btn" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 7.5L13.5 13.5M13.5 7.5L7.5 13.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
    </div>

    <div id="cc_controls_wrapper">
        <div id="cc_selected_pins_wrapper" class="cc_single_control_wrapper">
            <h1 id="cc_currently_selected_pins_count_elem" class="cc_count_display">0</h1>
            <p class="cc_count_label">Selected</p>
            <a id="cc_download_selected_pins_elem" class="cc_download_btn">Download</a>
        </div>
        <div class="cc_v_separator"></div>
        <div id="cc_board_count_wrapper" class="cc_single_control_wrapper">
            <h1 id="cc_current_board_count_elem" class="cc_count_display">N/A</h1>
            <p class="cc_count_label">On Board</p>
            <a id="cc_download_all_pins_elem" class="cc_download_btn">Download All</a>
        </div>
        <div class="cc_v_separator"></div>
        <div class="cc_single_control_wrapper">
            <h1 id="cc_select_all_visible_pins_elem">Select<br>Visible</h1>
        </div>
    </div>

    <section id="cc_section_2">
        <h1 id="cc_progress_log_elem">No logs to view right now.</h1>
    </section>

    <footer id="cc_section_3">
        <a id="cc_stateful_btn" data-stateful="true" role="button">Remember Pins (on)</a>
        <div id="cc_history_controls">
            <a id="cc_endless_btn" role="button">Endless</a>
            <a id="cc_import_btn" role="button">Import</a>
            <a id="cc_export_btn" role="button">Export</a>
        </div>
    </footer>

    <div id="cc_minimized_view">
        <svg width="22" height="22" viewBox="0 0 12 13" fill="none" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#clip_ui_min)"><rect y="0.5" width="12" height="12" rx="6" fill="#E9E9E9"/><path d="M3.77 12.075C3.70334 11.3917 3.74667 10.7367 3.9 10.11L4.5 7.52C4.38997 7.18576 4.33097 6.83684 4.325 6.485C4.325 5.645 4.73 5.045 5.37 5.045C5.81 5.045 6.135 5.355 6.135 5.945C6.135 6.135 6.09667 6.34833 6.02 6.585L5.76 7.445C5.71 7.61167 5.685 7.765 5.685 7.905C5.685 8.505 6.14 8.84 6.725 8.84C7.77 8.84 8.51 7.76 8.51 6.36C8.51 4.8 7.49 3.8 5.985 3.8C4.305 3.8 3.24 4.895 3.24 6.42C3.24 7.03 3.43 7.6 3.795 7.99C3.675 8.195 3.545 8.23 3.355 8.23C2.755 8.23 2.185 7.385 2.185 6.23C2.185 4.23 3.785 2.645 6.025 2.645C8.375 2.645 9.855 4.29 9.855 6.31C9.855 8.33 8.415 9.885 6.865 9.885C6.57003 9.88889 6.27821 9.82405 6.01265 9.69561C5.74709 9.56717 5.51508 9.37865 5.335 9.145L5.025 10.395C4.86976 11.0511 4.5952 11.6732 4.215 12.23C5.11334 12.5122 6.06554 12.5786 6.99435 12.4239C7.92316 12.2691 8.8024 11.8976 9.56075 11.3394C10.3191 10.7813 10.9352 10.0522 11.359 9.21135C11.7828 8.37051 12.0024 7.44161 12 6.5C12 4.9087 11.3679 3.38258 10.2426 2.25736C9.11742 1.13214 7.5913 0.5 6 0.5C4.4087 0.5 2.88258 1.13214 1.75736 2.25736C0.632143 3.38258 1.92232e-06 4.9087 1.92232e-06 6.5C-0.00095816 7.69967 0.35773 8.87208 1.02975 9.86585C1.70177 10.8596 2.65627 11.6291 3.77 12.075Z" fill="#BD081C"/></g><defs><clipPath id="clip_ui_min"><rect y="0.5" width="12" height="12" rx="6" fill="white"/></clipPath></defs></svg>
        <span id="cc_minimized_summary_badge">0</span>
    </div>
</div>`);

    DOM.full_ui_wrapper.self = full_ui_wrapper_elem;
    DOM.full_ui_wrapper.close_ui_elem.self = full_ui_wrapper_elem.querySelector('#cc_close_btn');
    DOM.full_ui_wrapper.selected_pins_wrapper.self = full_ui_wrapper_elem.querySelector('#cc_selected_pins_wrapper');
    DOM.full_ui_wrapper.selected_pins_wrapper.currently_selected_pins_count_elem.self = full_ui_wrapper_elem.querySelector('#cc_currently_selected_pins_count_elem');
    DOM.full_ui_wrapper.selected_pins_wrapper.start_download_btn.self = full_ui_wrapper_elem.querySelector('#cc_download_selected_pins_elem');
    DOM.full_ui_wrapper.board_count_wrapper.self = full_ui_wrapper_elem.querySelector('#cc_board_count_wrapper');
    DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self = full_ui_wrapper_elem.querySelector('#cc_current_board_count_elem');
    DOM.full_ui_wrapper.board_count_wrapper.start_download_btn.self = full_ui_wrapper_elem.querySelector('#cc_download_all_pins_elem');
    DOM.full_ui_wrapper.select_visible_pins_elem.self = full_ui_wrapper_elem.querySelector('#cc_select_all_visible_pins_elem');
    DOM.full_ui_wrapper.progress_log_elem.self = full_ui_wrapper_elem.querySelector('#cc_progress_log_elem');

    let pin_count = get_board_pin_count();
    if (pin_count?.pin_count >= 0) {
        update_element_html(DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self, pin_count.formatted_pin_count);
        logger('INFO', `Detected ${pin_count.pin_count} total pins on this board/section.`);
    } else {
        DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self.innerHTML = 'N/A';
        if (!is_on_board_page) {
            logger('INFO', 'Not on a board page.');
        } else {
            logger('WARN', 'Could not find the total pin count for this board/section.');
        }
    }

    DOM.full_ui_wrapper.select_visible_pins_elem.self.addEventListener('click', select_all_visible_pins);
    DOM.full_ui_wrapper.selected_pins_wrapper.start_download_btn.self.addEventListener('click', initialize_downloads);
    DOM.full_ui_wrapper.board_count_wrapper.start_download_btn.self.addEventListener('click', () => extract_board_pins(pin_count?.pin_count));
    DOM.full_ui_wrapper.close_ui_elem.self.addEventListener('click', close_full_ui);
    document.addEventListener('contextmenu', handle_click);

    document.addEventListener('scroll', mark_visible_pins_only);
    document.addEventListener('drop', mark_visible_pins_only);
    window.addEventListener('resize', mark_visible_pins_only);

    document.addEventListener('mousedown', handle_marquee_start);
    document.addEventListener('mousemove', handle_marquee_move);
    document.addEventListener('mouseup', handle_marquee_end);

    // Cleans up the marquee box if the mouse leaves the browser window mid-drag
    document.addEventListener('mouseleave', cleanup_marquee);

    // Escape key bails out of an active marquee drag without selecting anything
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && is_marquee_selecting) cleanup_marquee();
    });

    document.addEventListener('contextmenu', handle_marquee_end_on_contextmenu);

    document.body.style.userSelect = 'none';
    DOM.downloader_button.self.style.display = 'none';

    // Set initial state before appending so there's no flash
    full_ui_wrapper_elem.style.opacity = '0';
    full_ui_wrapper_elem.style.transform = 'scale(0.5) translateY(20px)';
    document.body.appendChild(full_ui_wrapper_elem);

    // Animate open: scale up + fade in
    if (window.gsap) {
        gsap.to(full_ui_wrapper_elem, {
            opacity: 1,
            y: 0,
            scale: 1,
            duration: 0.35,
            ease: 'power3.out',
            clearProps: 'opacity,y,scale',
            onComplete: () => {
                full_ui_wrapper_elem.style.transform = '';
            }
        });
    } else {
        full_ui_wrapper_elem.style.opacity = '1';
        full_ui_wrapper_elem.style.transform = '';
    }

    const state_control_btn = full_ui_wrapper_elem.querySelector('#cc_stateful_btn');
    const import_btn = full_ui_wrapper_elem.querySelector('#cc_import_btn');
    const export_btn = full_ui_wrapper_elem.querySelector('#cc_export_btn');
    const clear_history_btn = full_ui_wrapper_elem.querySelector('#cc_clear_history_btn');
    const endless_btn = full_ui_wrapper_elem.querySelector('#cc_endless_btn');
    const minimize_btn = full_ui_wrapper_elem.querySelector('#cc_minimize_btn');

    // --- HELP TOOLTIP ---
    const help_btn = full_ui_wrapper_elem.querySelector('#cc_help_btn');
    const tooltip = document.createElement('div');
    tooltip.id = 'cc_help_tooltip';
    tooltip.innerHTML = `
        <span class="cc_tip_title">How to use</span>
        <div class="cc_tip_row">
            <span class="cc_tip_icon">🖱️</span>
            <span class="cc_tip_copy"><strong>Select a pin</strong> — <kbd>Shift</kbd> + right-click any pin to select or deselect it.</span>
        </div>
        <div class="cc_tip_row">
            <span class="cc_tip_icon">⬜</span>
            <span class="cc_tip_copy"><strong>Marquee select</strong> — <kbd>Shift</kbd> + right-drag to draw a box around multiple pins at once.</span>
        </div>
        <div class="cc_tip_row">
            <span class="cc_tip_icon">⬇️</span>
            <span class="cc_tip_copy"><strong>Download All</strong> — auto-scrolls the entire board, finds every pin, then downloads the lot.</span>
        </div>`;
    document.body.appendChild(tooltip);

    let tooltip_tween = null;
    function position_tooltip() {
        const rect = help_btn.getBoundingClientRect();
        const tt_w = 226;
        let left = rect.left + rect.width / 2 - tt_w / 2;
        // clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - tt_w - 8));
        tooltip.style.left = left + 'px';
        tooltip.style.top = (rect.top - 8) + 'px'; // will be shifted up by transform
        tooltip.style.transform = 'translateY(-100%) scale(1)';
    }

    help_btn.addEventListener('mouseenter', () => {
        position_tooltip();
        if (tooltip_tween) tooltip_tween.kill();
        if (window.gsap) {
            gsap.set(tooltip, { display: 'block' });
            tooltip_tween = gsap.fromTo(tooltip,
                { opacity: 0, y: 6, scale: 0.95 },
                { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'power2.out' }
            );
        } else {
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
        }
    });

    help_btn.addEventListener('mouseleave', () => {
        if (tooltip_tween) tooltip_tween.kill();
        if (window.gsap) {
            tooltip_tween = gsap.to(tooltip, {
                opacity: 0, y: 4, scale: 0.95, duration: 0.16, ease: 'power2.in',
                onComplete: () => { gsap.set(tooltip, { display: 'none' }); }
            });
        } else {
            tooltip.style.display = 'none';
            tooltip.style.opacity = '0';
        }
    });

    // Hide tooltip if UI is closed/minimized
    help_btn.addEventListener('click', e => e.stopPropagation());
    // --- END HELP TOOLTIP ---

    // Restore minimized state on launch
    if (localStorage.getItem('pbdl_ui_minimized') === 'true') {
        full_ui_wrapper_elem.classList.add('cc_minimized');
        sync_minimized_summary();
    }

    minimize_btn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (full_ui_wrapper_elem.classList.contains('cc_minimized')) return;

        if (window.gsap) {
            gsap.to(full_ui_wrapper_elem.children, { opacity: 0, duration: 0.15 });
            gsap.to(full_ui_wrapper_elem, {
                width: 44, height: 44, duration: 0.35, ease: 'power3.inOut',
                onComplete: () => {
                    full_ui_wrapper_elem.classList.add('cc_minimized');
                    gsap.set(full_ui_wrapper_elem, { clearProps: 'width,height' });
                    gsap.set(full_ui_wrapper_elem.children, { clearProps: 'opacity' });
                    sync_minimized_summary();
                    const minView = full_ui_wrapper_elem.querySelector('#cc_minimized_view');
                    gsap.fromTo(minView, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.2, ease: 'back.out(2)' });
                }
            });
        } else {
            full_ui_wrapper_elem.classList.add('cc_minimized');
            sync_minimized_summary();
        }
        localStorage.setItem('pbdl_ui_minimized', 'true');
    });

    full_ui_wrapper_elem.addEventListener('click', (event) => {
        if (event.target.closest('#cc_close_btn, #cc_minimize_btn')) return;
        
        if (full_ui_wrapper_elem.classList.contains('cc_minimized')) {
            // EXPAND
            const minView = full_ui_wrapper_elem.querySelector('#cc_minimized_view');
            if (window.gsap) {
                gsap.to(minView, { opacity: 0, scale: 0.5, duration: 0.15 });
                full_ui_wrapper_elem.classList.remove('cc_minimized');
                gsap.from(full_ui_wrapper_elem, {
                    width: 44, height: 44, duration: 0.4, ease: 'power3.out',
                    clearProps: 'width,height'
                });
                gsap.from(full_ui_wrapper_elem.children, {
                    opacity: 0, delay: 0.15, duration: 0.25, stagger: 0.03
                });
            } else {
                full_ui_wrapper_elem.classList.remove('cc_minimized');
            }
            localStorage.setItem('pbdl_ui_minimized', 'false');
        }
    });

    state_control_btn.addEventListener("click", () => {
        stateful_mode = !stateful_mode;
        if (stateful_mode) {
            state_control_btn.dataset.stateful = "true";
            state_control_btn.innerHTML = "Remember Pins (on)";
            logger('INFO', `"Remember Pins" is now ON.`);
        } else {
            state_control_btn.dataset.stateful = "false";
            state_control_btn.innerHTML = "Remember Pins (off)";
            logger('INFO', `"Remember Pins" is now OFF.`);
        }
    });

    import_btn.addEventListener('click', import_history);
    export_btn.addEventListener('click', export_history);
    clear_history_btn.addEventListener('click', clear_history);
    endless_btn.addEventListener('click', toggle_endless_mode);
    return;
}

// --- ENDLESS MODE LOGIC ---
function toggle_endless_mode() {
    const endless_btn = document.querySelector('#cc_endless_btn');
    if (!endless_btn) return;

    if (endless_mode_active) {
        stop_endless_mode();
    } else {
        start_endless_mode();
    }
}

function start_endless_mode() {
    if (endless_mode_active) return;

    // Stop other potential operations
    cancel_downloads = false;
    if (observer_running) {
        observer?.disconnect();
        clearInterval(timeout_watcher_interval);
        clearInterval(auto_scroll_interval);
        observer_running = false;
    }

    endless_mode_active = true;
    endless_total_downloaded = 0;

    // UI Updates
    const endless_btn = document.querySelector('#cc_endless_btn');
    endless_btn.innerHTML = "STOP (Endless)";
    endless_btn.dataset.active = "true";
    DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
    update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.endless_active);
    endless_is_downloading = false;
    logger('INFO', `Starting Endless Mode. Will download every ${endless_batch_size} pins.`);

    // Clear current selection to start fresh
    selected_pins.clear();
    update_currently_selected_pins();

    run_endless_loop();
}

function stop_endless_mode() {
    if (!endless_mode_active) return;

    endless_mode_active = false;
    endless_is_downloading = false;
    cancel_downloads = true;

    // Stop internals
    clearInterval(auto_scroll_interval);
    observer?.disconnect();
    observer = null;
    observer_running = false;

    // UI Updates
    const endless_btn = document.querySelector('#cc_endless_btn');
    endless_btn.innerHTML = "Endless Mode";
    endless_btn.dataset.active = "false";

    DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_warning';
    update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.endless_stop + ` Total session: ${endless_total_downloaded}`);
    logger('INFO', `Endless Mode stopped. Total pins downloaded this session: ${endless_total_downloaded}`);
}

async function run_endless_loop() {
    let target_elem = document.querySelector('[data-test-id="board-feed"]') ||
        document.querySelector('[data-test-id="board-section-feed"]') ||
        document.querySelector('[data-test-id="grid"]') ||
        document.querySelector('[role="main"]') ||
        document.body;

    let observer_options = { childList: true, subtree: true };
    observer_running = true;

    // Initial grab
    select_all_visible_pins();

    observer = new MutationObserver(async (mutation_records) => {
        if (!endless_mode_active) return;

        let found_new = false;
        for (let record of mutation_records) {
            if (record.type !== 'childList') continue;
            for (let node of record.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;

                let anchors = Array.from(node.querySelectorAll('a[href*="/pin/"]'));
                // Catch the node itself if it's the anchor 
                if (node.tagName === 'A' && node.href && node.href.includes('/pin/')) {
                    anchors.push(node);
                }

                for (let link of anchors) {
                    let href = link?.href;
                    if (!href) continue;

                    let urls = clean_pin_urls([href]);
                    if (urls.length === 0) continue;
                    let url = urls[0];

                    if (!downloaded_pins.has(url) && !selected_pins.has(url)) {
                        // Extract metadata IMMEDIATELY so we don't lose it if Pinterest evicts the DOM node before batch is ready
                        let pin_element = link.closest('[data-test-id="pin"]') || node;
                        let img = pin_element.querySelector('img');
                        let img_srcset = img?.srcset || img?.src || '';
                        let image_url = img_srcset ? parse_srcset(img_srcset, true) : '';

                        if (image_url) {
                            image_url = image_url.replace(/\/[\d]+x\//, '/originals/');
                        }

                        let has_video = !!pin_element.querySelector('video');

                        selected_pins.set(url, { url, image_url, media_urls: [], has_video });
                        found_new = true;

                        // Inject visual highlight
                        let overlay_host = pin_element.querySelector('a[href*="/pin/"]') || pin_element.querySelector('[data-test-id="visual-content-container"]');
                        if (overlay_host) {
                            inject_selected_overlay(overlay_host, 'selected', true);
                        }
                    }
                }
            }
        }

        if (found_new) update_currently_selected_pins();

        // CHECK BATCH SIZE
        if (selected_pins.size >= endless_batch_size && !endless_is_downloading) {
            endless_is_downloading = true;
            // PAUSE SCROLLING & OBSERVING
            observer.disconnect();
            clearInterval(auto_scroll_interval);

            logger('INFO', `Endless Mode: Batch of ${selected_pins.size} reached. Downloading...`);
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `Endless Mode: Downloading batch...`);

            // Populate metadata for the batch (URLs, etc)
            await populate_metadata_for_endless_batch();

            // DOWNLOAD BATCH
            const batch_items = [];
            for (const pin of selected_pins.values()) {
                if (pin.media_urls && pin.media_urls.length > 0) {
                    if (pin.media_urls.length === 1) {
                        batch_items.push({ media_url: pin.media_urls[0], pin_url: pin.url, image_url: pin.image_url });
                    } else {
                        pin.media_urls.forEach((url, index) => {
                            batch_items.push({ media_url: url, pin_url: pin.url, slide_index: index + 1, image_url: pin.image_url });
                        });
                    }
                } else if (pin.image_url) {
                    batch_items.push({ media_url: pin.image_url, pin_url: pin.url });
                }
            }

            if (batch_items.length > 0) {
                try {
                    const stats = await download_pins(batch_items);
                    endless_total_downloaded += stats.successful_downloads;
                    localStorage.setItem('downloaded_pins', JSON.stringify([...downloaded_pins]));
                    localStorage.setItem('downloaded_media_urls', JSON.stringify([...downloaded_media_urls]));
                    logger('INFO', `Batch complete. Total endless downloads: ${endless_total_downloaded}`);
                } catch (e) {
                    logger('ERROR', 'Endless batch download error', e);
                }
            }

            // CLEANUP & RESUME
            selected_pins.clear();
            update_currently_selected_pins();
            endless_is_downloading = false;

            if (endless_mode_active) {
                logger('INFO', 'Endless Mode: Batch finished. Resuming...');
                DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
                update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.endless_batch_done);

                observer.observe(target_elem, observer_options);
                start_auto_scrolling();
            }
        }
    });

    observer.observe(target_elem, observer_options);
    start_auto_scrolling();
}

async function populate_metadata_for_endless_batch() {
    const pins = Array.from(selected_pins.values());
    let processed = 0;
    
    // Grab all loaded data from page memory first
    await extract_memory_pins();
    
    for (let i = 0; i < pins.length; i++) {
        if (!endless_mode_active) break;
        const pin = pins[i];
        try {
            const urls = await fetch_pin_media(pin.url);
            if (urls && urls.length > 0) {
                pin.media_urls = urls;
            } else if (pin.image_url) {
                pin.media_urls = [pin.image_url];
            }
        } catch (err) {
            if (pin.image_url) pin.media_urls = [pin.image_url];
        }
        processed++;
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `Endless Mode: Extracting media ${processed}/${pins.length}...`);
        if (i < pins.length - 1) await new Promise(r => setTimeout(r, 300));
    }
}
// --- END ENDLESS MODE LOGIC ---

function export_history() {
    if (downloaded_pins.size === 0) {
        logger('WARN', 'Export failed: Download history is empty.');
        alert('Your download history is empty. Nothing to export.');
        return;
    }
    const history_array = Array.from(downloaded_pins);
    const history_blob = new Blob([JSON.stringify(history_array, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(history_blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pinterest_downloader_history_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    logger('INFO', `Successfully exported ${downloaded_pins.size} pins to JSON.`);
}

function import_history() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = (event) => {
        const file = event.target.files[0];
        if (!file) {
            logger('WARN', 'Import cancelled: No file selected.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported_data = JSON.parse(e.target.result);
                if (!Array.isArray(imported_data)) {
                    throw new Error('Invalid format: JSON file is not an array.');
                }
                const initial_size = downloaded_pins.size;
                const imported_pins = new Set(imported_data.filter(item => typeof item === 'string'));
                const merged_pins = new Set([...downloaded_pins, ...imported_pins]);

                downloaded_pins = merged_pins;
                localStorage.setItem('downloaded_pins', JSON.stringify([...downloaded_pins]));

                const new_pins_count = downloaded_pins.size - initial_size;
                logger('INFO', `Import successful. Added ${new_pins_count} new pins. Total history is now ${downloaded_pins.size}.`);
                alert(`Import successful!\nAdded ${new_pins_count} new pins.\nTotal history size is now ${downloaded_pins.size}.`);

                remark_selected_pins();

            } catch (error) {
                logger('ERROR', 'Failed to import history from file.', error);
                alert(`Import Failed:\n${error.message}`);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function clear_history() {
    const confirmation = confirm("Are you sure you want to clear your entire download history? This action cannot be undone.");
    if (confirmation) {
        downloaded_pins.clear();
        downloaded_media_urls.clear();
        localStorage.removeItem('downloaded_pins');
        localStorage.removeItem('downloaded_media_urls');
        logger('INFO', 'Download history has been cleared.');
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_success';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, 'History cleared successfully.');
        alert('Download history has been successfully cleared.');
        remark_selected_pins();
    } else {
        logger('INFO', 'User cancelled the history clear action.');
    }
}

async function remark_selected_pins() {
    logger('DEBUG', `Screen changed. Re-highlighting selected pins that are visible.`);
    mark_visible_pins_only();
}

// Function to keep visual overlays synchronized without crushing scroll performance
function mark_visible_pins_only() {
    // Quickly grab DOM URLs currently rendered
    let visible_links = Array.from(document.querySelectorAll('[data-test-id="pin"] a[href*="/pin/"]'))
        .map(a => a.href)
        .filter(Boolean);

    if (document.querySelector('[data-test-id="closeup-visual-container"]')) {
        visible_links.push(window.location.href);
    }

    let pin_urls = clean_pin_urls(visible_links);

    for (let url of new Set(pin_urls)) {
        let status = null;
        if (downloaded_pins.has(url)) status = 'downloaded';
        else if (failed_pins.has(url)) status = 'failed';
        else if (selected_pins.has(url)) status = 'selected';

        const pin_element = get_pin_element_by_url(url);
        if (!pin_element) continue;

        const overlay_host = pin_element.querySelector('a[href*="/pin/"]') || pin_element.querySelector('[data-test-id="visual-content-container"]');
        if (!overlay_host) continue;

        if (status) {
            inject_selected_overlay(overlay_host, status, true);
        } else {
            const existing = overlay_host.querySelector('[data-selected-overlay]');
            if (existing) existing.remove();
        }
    }
}

async function handle_click(event) {
    if (event.shiftKey) {
        event.preventDefault();

        // Skip single-pin selection if we just finished dragging the marquee
        if (did_marquee_drag) {
            did_marquee_drag = false;
            return;
        }

        const element_below = document.elementFromPoint(event.clientX, event.clientY);
        if (!element_below) return;

        let pin_url = null;
        const grid_pin_match = element_below.closest('[data-test-id="pin"]');
        const main_pin_match = element_below.closest('[data-test-id="closeup-visual-container"]');

        if (grid_pin_match) {
            const pinLink = grid_pin_match.querySelector('a[href*="/pin/"]');
            pin_url = pinLink?.href || '';
        } else if (main_pin_match) {
            pin_url = window.location.href;
        }

        if (typeof pin_url === 'string' && pin_url.length > 0) {
            pin_url = clean_pin_urls([pin_url])?.at(0);
            if (pin_url) {
                if (selected_pins.has(pin_url)) {
                    logger('INFO', `Pin unselected: ${pin_url}`);
                    unselect_pins([pin_url]);
                } else {
                    logger('INFO', `Pin selected: ${pin_url}`);
                    select_pins([pin_url]);
                }
            }
        }
    }
}

function cleanup_marquee() {
    // Nuclear cleanup — kills ALL stray marquee divs, not just the tracked one
    document.querySelectorAll('#cc_marquee_overlay').forEach(el => el.remove());
    if (marquee_div) { marquee_div.remove(); marquee_div = null; }
    if (marquee_raf) { cancelAnimationFrame(marquee_raf); marquee_raf = null; }
    is_marquee_selecting = false;
}

function handle_marquee_start(e) {
    if (e.shiftKey && e.button === 2) {
        if (DOM.full_ui_wrapper.self && DOM.full_ui_wrapper.self.contains(e.target)) return;

        // Always nuke any leftover marquee before starting a fresh one
        cleanup_marquee();

        is_marquee_selecting = true;
        did_marquee_drag = false;
        start_marquee_x = e.clientX;
        start_marquee_y = e.clientY;

        marquee_div = document.createElement('div');
        marquee_div.id = 'cc_marquee_overlay';
        Object.assign(marquee_div.style, {
            position: 'fixed',
            border: '1px solid var(--cc_accent_1)',
            backgroundColor: 'var(--cc_bg_accent_2)',
            zIndex: '999999',
            pointerEvents: 'none',
            willChange: 'transform, width, height',
            left: '0px',
            top: '0px',
            transform: `translate(${start_marquee_x}px, ${start_marquee_y}px)`,
            width: '0px',
            height: '0px',
        });

        document.body.appendChild(marquee_div);
    }
}

function handle_marquee_move(e) {
    if (!is_marquee_selecting || !marquee_div) return;

    // Prevent native drag actions from ruining the marquee process
    e.preventDefault();

    current_marquee_x = e.clientX;
    current_marquee_y = e.clientY;

    // Only queue a layout update if one isn't already waiting
    if (!marquee_raf) {
        marquee_raf = requestAnimationFrame(() => {
            let x = Math.min(start_marquee_x, current_marquee_x);
            let y = Math.min(start_marquee_y, current_marquee_y);
            let w = Math.abs(current_marquee_x - start_marquee_x);
            let h = Math.abs(current_marquee_y - start_marquee_y);

            // If the mouse actually moves a bit, register it as a drag
            if (w > 5 || h > 5) did_marquee_drag = true;

            // Use GPU-accelerated translate instead of top/left
            marquee_div.style.transform = `translate(${x}px, ${y}px)`;
            marquee_div.style.width = w + 'px';
            marquee_div.style.height = h + 'px';

            marquee_raf = null; // Clear the lock allowing the next frame to trigger
        });
    }
}

function handle_marquee_end_on_contextmenu(e) {
    if (is_marquee_selecting) {
        handle_marquee_end(e);
    }
}

function capture_marquee_click(e) {
    e.preventDefault();
    e.stopPropagation();
}

function handle_marquee_end(e) {
    if (!is_marquee_selecting) return;

    // Snapshot rect before cleanup removes the element
    let rect = marquee_div ? marquee_div.getBoundingClientRect() : null;
    const was_drag = did_marquee_drag;

    cleanup_marquee();
    did_marquee_drag = false;

    if (rect && rect.width > 5 && rect.height > 5) {
        window.addEventListener('click', capture_marquee_click, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', capture_marquee_click, { capture: true }), 0);

        let pin_elements = document.querySelectorAll('[data-test-id="pin"]');
        let pins_to_select = [];
        let pins_to_unselect = [];

        for (let pin of pin_elements) {
            let pin_rect = pin.getBoundingClientRect();
            let intersect = !(
                rect.right < pin_rect.left ||
                rect.left > pin_rect.right ||
                rect.bottom < pin_rect.top ||
                rect.top > pin_rect.bottom
            );
            if (intersect) {
                let link = pin.querySelector('a[href*="/pin/"]');
                if (link && link.href) {
                    if (e.altKey) pins_to_unselect.push(link.href);
                    else pins_to_select.push(link.href);
                }
            }
        }

        if (pins_to_select.length > 0) {
            logger('INFO', `Marquee selected ${pins_to_select.length} pins.`);
            select_pins(pins_to_select);
        }
        if (pins_to_unselect.length > 0) {
            logger('INFO', `Marquee unselected ${pins_to_unselect.length} pins.`);
            unselect_pins(pins_to_unselect);
        }
    }
}


async function extract_board_pins(pin_count) {
    // Check if we're on a board page
    if (!check_if_board_page()) {
        logger('WARN', 'Cannot extract board pins - not on a board page.');
        return;
    }

    // Stop Endless Mode if active
    if (endless_mode_active) stop_endless_mode();

    logger('INFO', `Starting automatic search for all ${pin_count} pins on the board/section...`);
    if (!Number.isInteger(pin_count) || pin_count <= 0) {
        logger('ERROR', `Cannot start search: Invalid pin count provided.`, { pin_count });
        update_element_html(DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self, 'N/A');
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_error';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.board_count_error);
        return;
    }

    if (!stateful_mode) {
        selected_pins.clear();
        logger('INFO', `Cleared selection list because "Remember Pins" is off.`);
    }

    observer = new MutationObserver((mutation_records) => {
        let pin_urls = new Set();
        let current_time = Date.now();
        for (let record of mutation_records) {
            if (record.type !== 'childList') continue;
            for (let node of record.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                let matches = Array.from(node.querySelectorAll('[data-test-id="pin"] a[href*="/pin/"]')).map(link => link?.href).filter(Boolean);
                if (matches.length > 0) {
                    clean_pin_urls(matches).forEach(url => pin_urls.add(url));
                    last_pin_received_time = current_time;
                }
            }
        }

        if (pin_urls.size > 0) {
            select_pins([...pin_urls]);
            let extraction_percentage = ((selected_pins.size / pin_count) * 100).toFixed(2);
            logger('INFO', `Found ${pin_urls.size} new pins. Total found: ${selected_pins.size} of ${pin_count}.`);
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `${message_template.extraction_progress}: ${extraction_percentage}% (${selected_pins.size}/${pin_count} pins)`);
        }

        if (selected_pins.size >= pin_count) {
            logger('INFO', `Search complete! Found all ${selected_pins.size} pins.`);
            clearInterval(timeout_watcher_interval);
            clearInterval(auto_scroll_interval);
            observer?.disconnect();
            observer = null;
            observer_running = false;
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_success';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.extraction_success);
            initialize_downloads();
            if (!stateful_mode) unselect_pins(Array.from(selected_pins.keys()));
        }
    });

    let target_elem = document.querySelector('[data-test-id="board-feed"]') ||
        document.querySelector('[data-test-id="board-section-feed"]') ||
        document.querySelector('[role="main"]') ||
        document.body;
    let observer_options = { childList: true, subtree: true };
    select_all_visible_pins();
    observer_running = true;
    last_pin_received_time = Date.now();
    observer.observe(target_elem, observer_options);
    logger('INFO', `Scrolling page to find all pins. Please do not close this tab.`);

    startTimeoutWatcher();

    window.scrollTo({ top: 0 });
    await new Promise((res) => setTimeout(res, 500));
    start_auto_scrolling();
}

function startTimeoutWatcher() {
    if (timeout_watcher_interval) clearInterval(timeout_watcher_interval);

    timeout_watcher_interval = setInterval(async () => {
        if (!observer_running) {
            clearInterval(timeout_watcher_interval);
            return;
        }

        const time_passed = Date.now() - last_pin_received_time;
        // INCREASED TIMEOUT for large boards
        if (time_passed > last_pin_received_cut_off_duration_ms) {
            logger('WARN', `Search stopped: No new pins were found in the last ${Math.round(last_pin_received_cut_off_duration_ms / 1000)} seconds.`);
            clearInterval(timeout_watcher_interval);
            clearInterval(auto_scroll_interval);
            observer?.disconnect();
            observer = null;
            observer_running = false;
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_warning';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `Pin search stopped. Proceeding to download ${selected_pins.size} found pins.`);

            // If in normal board mode, start download
            if (!endless_mode_active) {
                await initialize_downloads();
            }
        } else if (time_passed > 10000) {
            // Aggressive scroll check: if stuck for 10s, try random jumps
            window.scrollBy(0, -500);
            setTimeout(() => window.scrollBy(0, 1000), 200);

            const time_remaining = Math.max(0, last_pin_received_cut_off_duration_ms - time_passed);
            const seconds_remaining = Math.ceil(time_remaining / 1000);
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log cc_countdown';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `${message_template.waiting_for_pins} ${seconds_remaining}s`);
        }
    }, 2000);
}

function start_auto_scrolling(delay = 1000, human_behavior = true) {
    if (auto_scroll_interval) clearInterval(auto_scroll_interval);

    auto_scroll_interval = setInterval(() => {
        if (!observer_running || cancel_downloads) {
            clearInterval(auto_scroll_interval);
            logger('WARN', `Auto-scrolling has been stopped.`);
            return;
        }

        const isAtBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 200;

        if (!isAtBottom) {
            const px = window.innerHeight * 0.75;
            let altered_px = human_behavior ? px + (Math.random() * px * 0.2) : px;
            window.scrollTo({ top: window.scrollY + altered_px, behavior: 'smooth' });
        } else {
            // If at bottom but waiting for pins, wiggle up slightly to trigger loaders
            window.scrollBy(0, -100);
        }
    }, delay);
}


function get_csrf_token() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const parts = cookie.trim().split('=');
        if (parts[0] === 'csrftoken') {
            return parts[1];
        }
    }
    logger('WARN', 'Could not find CSRF token in cookies.');
    return null;
}

async function extract_memory_pins() {
    return new Promise((resolve) => {
        const script = document.createElement('script');
        const listener = function(event) {
            if (event.source !== window || event.data.type !== 'PINTEREST_STORE_DATA') return;
            window.removeEventListener('message', listener);
            script.remove();
            
            if (event.data.payload) {
                const pins = event.data.payload;
                const count = Object.keys(pins).length;
                if (count > 0) {
                    logger('INFO', `Extracted ${count} pins directly from page memory cache.`);
                    // Update our global cache
                    for (const id in pins) {
                        memory_cached_pins[id] = pins[id];
                    }
                }
            }
            resolve();
        };
        window.addEventListener('message', listener);
        
        script.textContent = `
            try {
                let pins = {};
                
                function extract_best_video(video_list) {
                    if (!video_list) return null;
                    const preferred_qualities = ['V_1080P', 'V_720P', 'V_480P', 'V_240P', 'V_HLSV4_MAC', 'V_HLSV4_IOS'];
                    for (const quality of preferred_qualities) {
                        if (video_list[quality]?.url) {
                            let url = video_list[quality].url;
                            if (url.includes('.mp4')) return url;
                        }
                    }
                    for (const key of Object.keys(video_list)) {
                        if (video_list[key]?.url && video_list[key].url.includes('.mp4')) {
                            return video_list[key].url;
                        }
                    }
                    return null;
                }

                function searchForPins(obj, depth = 0) {
                    if (depth > 7 || !obj || typeof obj !== 'object') return;
                    
                    if (obj.id && obj.type === 'pin') {
                        let urls = [];
                        if (obj.story_pin_data && obj.story_pin_data.pages) {
                            for (const page of obj.story_pin_data.pages) {
                                let found_media = false;
                                for (const block of (page.blocks || [])) {
                                    if (block.type === 'story_pin_video_block' && block.video?.video_list) {
                                        const url = extract_best_video(block.video.video_list);
                                        if (url) { urls.push(url); found_media = true; }
                                    } else if (block.type === 'story_pin_image_block' && block.image?.images?.originals?.url) {
                                        urls.push(block.image.images.originals.url);
                                        found_media = true;
                                    }
                                }
                                if (!found_media) {
                                    if (page.video?.video_list) {
                                        const url = extract_best_video(page.video.video_list);
                                        if (url) { urls.push(url); found_media = true; }
                                    }
                                    if (!found_media && page.image?.images?.originals?.url) {
                                        urls.push(page.image.images.originals.url);
                                    }
                                }
                            }
                        } else if (obj.carousel_data && obj.carousel_data.carousel_slots) {
                            for (const slot of obj.carousel_data.carousel_slots) {
                                if (slot.images?.originals?.url) {
                                    urls.push(slot.images.originals.url);
                                }
                            }
                        } else if (obj.videos?.video_list) {
                            const url = extract_best_video(obj.videos.video_list);
                            if (url) urls.push(url);
                        }
                        
                        if (urls.length === 0 && obj.video_urls) {
                            const vlist = Array.isArray(obj.video_urls) ? obj.video_urls : [obj.video_urls];
                            for (const v of vlist) {
                                if (typeof v === 'string' && v.length > 0) {
                                    urls.push(v);
                                    break;
                                }
                            }
                        }
                        
                        if (urls.length === 0 && obj.images?.originals?.url) {
                            urls.push(obj.images.originals.url);
                        }
                        
                        if (urls.length > 0) {
                            pins[obj.id] = urls;
                        }
                    }
                    
                    if (Array.isArray(obj)) {
                        for (let item of obj) searchForPins(item, depth + 1);
                    } else {
                        for (let key of Object.keys(obj)) {
                            if (key === 'related_pins' || key === 'relatedPins' || key === 'recommended_pins') continue;
                            searchForPins(obj[key], depth + 1);
                        }
                    }
                }
                
                if (window.__PWS_DATA__) searchForPins(window.__PWS_DATA__);
                if (window.__PWS_INITIAL_PROPS__) searchForPins(window.__PWS_INITIAL_PROPS__);
                if (window.__APOLLO_CLIENT__) {
                    const cache = window.__APOLLO_CLIENT__.cache.extract();
                    searchForPins(cache);
                }
                
                window.postMessage({ type: 'PINTEREST_STORE_DATA', payload: pins }, '*');
            } catch(e) {
                window.postMessage({ type: 'PINTEREST_STORE_DATA', payload: {} }, '*');
            }
        \`;
        document.documentElement.appendChild(script);
        
        setTimeout(() => {
            window.removeEventListener('message', listener);
            if (script.parentNode) script.remove();
            resolve();
        }, 1500);
    });
}

async function fetch_pin_media(pin_slug) {
    const pin_id = pin_slug.split('/').filter(Boolean).pop();
    
    // Check local memory cache first!
    if (memory_cached_pins[pin_id] && memory_cached_pins[pin_id].length > 0) {
        logger('INFO', `Found pin ${pin_id} in memory cache! Skipping API call.`);
        return memory_cached_pins[pin_id];
    }
    
    const csrf_token = get_csrf_token();

    if (!csrf_token) {
        logger('ERROR', 'CSRF token is missing. Cannot make an authenticated API request.');
        return null;
    }

    const request_data = {
        "options": { "id": pin_id, "field_set_key": "detailed" },
        "context": {}
    };
    const api_url = `${window.location.origin}/resource/PinResource/get/?source_url=/pin/${pin_id}/&data=${encodeURIComponent(JSON.stringify(request_data))}`;

    try {
        let pinData = null;
        
        // Get app version from page meta if available
        const app_version_meta = document.querySelector('meta[name="pinterest-generated-timestamp"]');
        const app_version = document.querySelector('script[src*="webapp"]')?.src?.match(/\/([a-f0-9]+)\//)?.[1] || '';
        
        const api_headers = { 
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest', 
            'X-CSRFToken': csrf_token,
            'X-Pinterest-AppState': 'active',
            'X-Pinterest-Source-Url': `/pin/${pin_id}/`,
        };
        if (app_version) api_headers['X-APP-VERSION'] = app_version;

        const response = await fetch(api_url, {
            method: 'GET',
            headers: api_headers,
            credentials: 'same-origin'
        });

        if (response.ok) {
            const json_data = await response.json();
            pinData = json_data?.resource_response?.data;
        }
        
        // Retry with different field_set_key if first attempt failed
        if (!pinData) {
            const retry_data = {
                "options": { "id": pin_id, "field_set_key": "unauth_react_main_pin" },
                "context": {}
            };
            const retry_url = `${window.location.origin}/resource/PinResource/get/?source_url=/pin/${pin_id}/&data=${encodeURIComponent(JSON.stringify(retry_data))}`;
            const retry_response = await fetch(retry_url, {
                method: 'GET',
                headers: api_headers,
                credentials: 'same-origin'
            });
            if (retry_response.ok) {
                const json_data = await retry_response.json();
                pinData = json_data?.resource_response?.data;
            }
        }

        // --- HTML FALLBACK (If API 403s or fails) ---
        if (!pinData) {
            logger('WARN', `API failed for pin ${pin_id}, falling back to HTML extraction...`);
            const html_response = await fetch(`/pin/${pin_id}/`);
            if (html_response.ok) {
                const html_text = await html_response.text();
                
                // Helper to recursively find the correct pin object regardless of the GraphQL query name
                function findPinObj(obj) {
                    if (!obj || typeof obj !== 'object') return null;
                    if (obj.id === pin_id && (obj.type === 'pin' || obj.videos || obj.story_pin_data || obj.images)) return obj;
                    if (Array.isArray(obj)) {
                        for (let item of obj) {
                            const res = findPinObj(item);
                            if (res) return res;
                        }
                    } else {
                        for (const key of Object.keys(obj)) {
                            if (key === 'related_pins' || key === 'relatedPins' || key === 'recommended_pins') continue;
                            const res = findPinObj(obj[key]);
                            if (res) return res;
                        }
                    }
                    return null;
                }

                // Strategy 1: Try to find pin JSON in Relay blocks
                const relay_splits = html_text.split('__PWS_RELAY_REGISTER_COMPLETED_REQUEST__');
                for (let i = 1; i < relay_splits.length; i++) {
                    if (relay_splits[i].includes(`"id":"${pin_id}"`)) {
                        const match = relay_splits[i].match(/\(.*?, (\{.*?\})\);/);
                        if (match) {
                            try {
                                const data = JSON.parse(match[1]);
                                const pin_obj = findPinObj(data);
                                if (pin_obj) {
                                    pinData = pin_obj;
                                    logger('INFO', `Found pin in Relay data for ${pin_id}`);
                                    break;
                                }
                            } catch (e) {}
                        }
                    }
                }

                // Strategy 2: Try raw regex to find V_ video keys (returns only 1 best video)
                if (!pinData) {
                    const v_regex = /(?:"|&quot;|"|\\")?(?:V_1080P|V_720P|V_480P|V_240P|V_ENC_1080P|V_ENC_720P|V_ENC_480P)(?:"|&quot;|"|\\")?/gi;
                    let has_v_keys = v_regex.test(html_text);
                    
                    if (has_v_keys) {
                        // Use a detailed regex to extract quality + url pairs
                        const v_detail_regex = /(?:"|&quot;|"|\\")(V_1080P|V_720P|V_480P|V_240P|V_ENC_1080P|V_ENC_720P|V_ENC_480P)(?:"|&quot;|"|\\")\s*:\s*\{[^}]*(?:"|&quot;|"|\\")?url(?:"|&quot;|"|\\")\s*:\s*(?:"|&quot;|"|\\")(https:[^"'&\s<>]+)(?:"|&quot;|"|\\")?/gi;
                        const v_matches = [];
                        let m;
                        while ((m = v_detail_regex.exec(html_text)) !== null) {
                            const quality = m[1].toUpperCase();
                            let url = m[2].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, '');
                            if (!url.includes('.m3u8') && url.includes('.mp4')) {
                                v_matches.push({ quality, url });
                            }
                        }
                        
                        if (v_matches.length > 0) {
                            logger('INFO', `Found ${v_matches.length} video URLs via V_ keys in HTML for pin ${pin_id}`);
                            // Group by video hash
                            let slides = {};
                            for (const v of v_matches) {
                                const filename = v.url.split('/').pop().split('?')[0];
                                const base_id = filename.split('_')[0].split('.')[0];
                                if (!slides[base_id]) slides[base_id] = [];
                                slides[base_id].push(v);
                            }
                            
                            // Return only the FIRST unique video (best quality)
                            const first_key = Object.keys(slides)[0];
                            const versions = slides[first_key];
                            let best = versions.find(v => v.quality.includes('1080P')) || versions.find(v => v.quality.includes('720P')) || versions.find(v => v.quality.includes('480P')) || versions[0];
                            return [best.url];
                        }
                    }

                    // Strategy 3: Find any MP4 URL
                    const mp4_regex = /(https:(?:\\\/|\/){2,}[^"'\s<>&]+\.mp4[^"'\s<>&]*)/gi;
                    const mp4s = [];
                    let m;
                    while ((m = mp4_regex.exec(html_text)) !== null) {
                        mp4s.push(m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\/g, ''));
                    }
                    
                    if (mp4s.length > 0) {
                        logger('INFO', `Found ${mp4s.length} MP4 URLs via regex in HTML for pin ${pin_id}`);
                        return [mp4s[0]];
                    }
                    
                    // Strategy 4: Find original image URL
                    const img_regex = /"(https:\/\/[^"]+\/originals\/[^"]+\.(?:jpg|png|webp))"/g;
                    const imgs = [];
                    while ((m = img_regex.exec(html_text)) !== null) {
                        imgs.push(m[1].replace(/\\u0026/g, '&').replace(/\\/g, ''));
                    }
                    if (imgs.length > 0) {
                        return [imgs[0]];
                    }
                }
            }
        }

        if (!pinData) {
            logger('WARN', `No pin data found in API or HTML for pin ${pin_id}`);
            return null;
        }

        let media_urls = [];

        // Helper: extract best video URL from a video_list object
        function extract_best_video(video_list) {
            if (!video_list) return null;
            const quality_order = ['V_720P', 'V_1080P', 'V_480P', 'V_240P', 'V_ENC_720P', 'V_ENC_1080P', 'V_ENC_480P', 'V_ENC_240P'];
            // First try named qualities
            for (const q of quality_order) {
                if (video_list[q]?.url) {
                    return video_list[q].url;
                }
            }
            // Fallback: pick the first entry that has a URL
            for (const key of Object.keys(video_list)) {
                if (video_list[key]?.url) {
                    return video_list[key].url;
                }
            }
            return null;
        }

        // 1. Story Pin (multi-page)
        if (pinData.story_pin_data && pinData.story_pin_data.pages) {
            logger('DEBUG', `Pin ${pin_id}: Detected Story Pin with ${pinData.story_pin_data.pages.length} pages`);
            for (const page of pinData.story_pin_data.pages) {
                let found_media = false;
                for (const block of (page.blocks || [])) {
                    if (block.type === 'story_pin_video_block' && block.video?.video_list) {
                        const url = extract_best_video(block.video.video_list);
                        if (url) { media_urls.push(url); found_media = true; }
                    } else if (block.type === 'story_pin_image_block' && block.image?.images?.originals?.url) {
                        media_urls.push(block.image.images.originals.url);
                        found_media = true;
                    }
                }
                // Fallback: page-level video or image
                if (!found_media) {
                    if (page.video?.video_list) {
                        const url = extract_best_video(page.video.video_list);
                        if (url) { media_urls.push(url); found_media = true; }
                    }
                    if (!found_media && page.image?.images?.originals?.url) {
                        media_urls.push(page.image.images.originals.url);
                    }
                }
            }
        }
        // 2. Carousel (multi-image)
        else if (pinData.carousel_data && pinData.carousel_data.carousel_slots) {
            logger('DEBUG', `Pin ${pin_id}: Detected Carousel with ${pinData.carousel_data.carousel_slots.length} slots`);
            for (const slot of pinData.carousel_data.carousel_slots) {
                if (slot.images?.originals?.url) {
                    media_urls.push(slot.images.originals.url);
                }
            }
        }
        // 3. Regular video pin
        else if (pinData.videos?.video_list) {
            logger('DEBUG', `Pin ${pin_id}: Detected video pin`);
            const url = extract_best_video(pinData.videos.video_list);
            if (url) {
                media_urls.push(url);
            }
        }

        // 4. If no media found yet, check for video_urls field (alternative video storage)
        if (media_urls.length === 0 && pinData.video_urls) {
            logger('DEBUG', `Pin ${pin_id}: Found video_urls field`);
            const video_url_list = Array.isArray(pinData.video_urls) ? pinData.video_urls : [pinData.video_urls];
            for (const v of video_url_list) {
                if (typeof v === 'string' && v.length > 0) {
                    media_urls.push(v);
                    break;
                }
            }
        }

        // 5. Fallback to highest quality image
        if (media_urls.length === 0 && pinData.images?.originals?.url) {
            logger('DEBUG', `Pin ${pin_id}: Falling back to originals image`);
            media_urls.push(pinData.images.originals.url);
        }

        logger('INFO', `Pin ${pin_id}: Extracted ${media_urls.length} media URL(s)`);
        return media_urls.length > 0 ? [...new Set(media_urls)] : null;

    } catch (error) {
        logger('ERROR', `Failed to fetch media for pin ${pin_id}`, { original_error: error });
        return null;
    }
}


async function initialize_downloads() {
    logger('INFO', 'Preparing to download selected pins...');
    failed_pins.clear();
    if (selected_pins.size === 0) {
        logger('WARN', 'Download cancelled: No pins are selected.');
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.select_error);
        return;
    }

    const pins_to_process = Array.from(selected_pins.values()).filter(p => !stateful_mode || !downloaded_pins.has(p.url));
    
    if (pins_to_process.length === 0) {
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_success';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, 'All selected pins have already been downloaded.');
        return;
    }

    let processed = 0;
    let video_count = 0;
    let image_count = 0;
    let failed_count = 0;
    const total = pins_to_process.length;
    DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
    update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `Extracting high-res media: 0/${total}`);
    
    // Grab all loaded data from page memory first
    await extract_memory_pins();

    // Process pins ONE AT A TIME with a small delay to avoid Pinterest rate-limiting
    for (let i = 0; i < pins_to_process.length; i++) {
        if (cancel_downloads) break;
        const pin = pins_to_process[i];
        try {
            const urls = await fetch_pin_media(pin.url);
            if (urls && urls.length > 0) {
                pin.media_urls = urls;
                for (const u of urls) {
                    if (u.includes('.mp4') || u.includes('/videos/') || u.includes('video')) {
                        video_count++;
                    } else {
                        image_count++;
                    }
                }
            } else if (pin.image_url) {
                pin.media_urls = [pin.image_url];
                image_count++;
                logger('WARN', `Pin ${pin.url}: API returned no media, falling back to thumbnail image`);
            } else {
                failed_pins.add(pin.url);
                failed_count++;
            }
        } catch (err) {
            logger('ERROR', `Exception extracting pin ${pin.url}`, err);
            if (pin.image_url) {
                pin.media_urls = [pin.image_url];
                image_count++;
            } else {
                failed_count++;
            }
        }
        processed++;
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `Extracting media: ${processed}/${total} (🎬${video_count} 🖼️${image_count})`);
        // Small delay between API calls to avoid rate-limiting
        if (i < pins_to_process.length - 1) await new Promise(r => setTimeout(r, 300));
    }

    if (cancel_downloads) return;

    logger('INFO', `Extraction complete: ${video_count} videos, ${image_count} images, ${failed_count} failed out of ${total} pins`);

    const download_items = [];
    for (const pin of pins_to_process) {
        if (pin.media_urls && pin.media_urls.length > 0) {
            if (pin.media_urls.length === 1) {
                download_items.push({ media_url: pin.media_urls[0], pin_url: pin.url, image_url: pin.image_url });
            } else {
                pin.media_urls.forEach((url, idx) => {
                    download_items.push({ media_url: url, pin_url: pin.url, slide_index: idx + 1, image_url: pin.image_url });
                });
            }
        }
    }

    logger('INFO', `Found ${download_items.length} files to download.`);

    if (download_items.length === 0) {
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_success';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, 'All selected pins have already been downloaded.');
        return;
    }

    try {
        let download_response = await download_pins(download_items);
        logger('INFO', 'Download process finished.', download_response);
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_success';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.download_success);
        localStorage.setItem('downloaded_pins', JSON.stringify([...downloaded_pins]));
        localStorage.setItem('downloaded_media_urls', JSON.stringify([...downloaded_media_urls]));
        logger('INFO', `Updated download history. Total history size: ${downloaded_pins.size} pins.`);
    } catch (err) {
        logger('ERROR', 'The download process failed.', { original_error: err });
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_error';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.download_error);
    } finally {
        // Remark visible pins so the ones downloaded successfully receive the visual overlays
        mark_visible_pins_only();
    }
}


function inject_selected_overlay(parentElement, status = 'selected', random = false) {
    if (!parentElement || parentElement.querySelector(`[data-selected-overlay="${status}"]`)) return;

    parentElement.querySelectorAll('[data-selected-overlay]').forEach(e => e.remove());

    if (window.getComputedStyle(parentElement).position !== 'relative') {
        parentElement.style.position = 'relative';
        parentElement.style.zIndex = '2';
    }

    let bgColor, borderColor;
    switch (status) {
        case 'downloaded':
            bgColor = 'var(--cc_bg_accent_success)';
            borderColor = 'var(--cc_success)';
            break;
        case 'failed':
            bgColor = 'var(--cc_bg_accent_warning)';
            borderColor = 'var(--cc_warning)';
            break;
        default: // 'selected'
            bgColor = 'var(--cc_bg_accent_2)';
            borderColor = 'var(--cc_accent_1)';
            break;
    }

    const newDiv = document.createElement('div');
    newDiv.setAttribute('data-selected-overlay', status);
    Object.assign(newDiv.style, {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        zIndex: '999999',
        backgroundColor: bgColor,
        boxShadow: `inset 0 0 0 clamp(5px, 0.6vw, 7px) ${borderColor}`,
        pointerEvents: 'none',
        opacity: '0',
    });

    let targetBorderRadius = window.getComputedStyle(parentElement).borderRadius;
    for (const descendant of parentElement.querySelectorAll('*')) {
        const currentRadius = window.getComputedStyle(descendant).borderRadius;
        if (currentRadius !== '0px' && currentRadius !== 'none') {
            targetBorderRadius = currentRadius;
            break;
        }
    }
    newDiv.style.borderRadius = targetBorderRadius;
    parentElement.prepend(newDiv);

    if (window.gsap) {
        gsap.fromTo(newDiv,
            { opacity: 0, scale: 0.94 },
            { opacity: 1, scale: 1, duration: random ? (0.2 + Math.random() * 0.1) : 0.18, ease: 'power2.out' }
        );
    } else {
        requestAnimationFrame(() => { newDiv.style.opacity = '1'; });
    }
}

function get_pin_element_by_url(url) {
    let element = document.querySelector(`[data-test-id="pin"]:has(a[href*="${url}"])`);
    if (element) return element;

    if (window.location.href.includes(url)) {
        return document.querySelector('[data-test-id="closeup-visual-container"]') ||
            document.querySelector('[data-test-id="visual-content-container"]') ||
            document.querySelector('[data-grid-item="true"]');
    }
    return null;
}


function select_all_visible_pins() {
    logger('INFO', 'Selecting all pins currently visible on the screen...');
    let pin_urls = Array.from(document.querySelectorAll('[data-test-id="pin"] a[href*="/pin/"]'))
        .map(link => link?.href)
        .filter(Boolean);

    if (document.querySelector('[data-test-id="closeup-visual-container"]')) {
        pin_urls.push(window.location.href);
    }

    if (pin_urls.length > 0) {
        select_pins(pin_urls);
        logger('INFO', `Selected ${pin_urls.length} visible pins.`);
    } else {
        logger('INFO', 'No visible pins found to select.');
    }
}

async function select_pins(pin_urls, reselect = false, subtle = true) {
    pin_urls = clean_pin_urls(pin_urls);
    let selection_changed = false;

    for (let url of new Set(pin_urls)) {
        const pin_element = get_pin_element_by_url(url);
        if (!pin_element) continue;

        const overlay_host = pin_element.querySelector('a[href*="/pin/"]') || pin_element.querySelector('[data-test-id="visual-content-container"]');
        if (!overlay_host) continue;

        let status = 'selected';
        if (downloaded_pins.has(url)) status = 'downloaded';
        else if (failed_pins.has(url)) status = 'failed';

        if (reselect) {
            inject_selected_overlay(overlay_host, status, subtle);
            continue;
        }

        if (selected_pins.has(url)) continue;

        selection_changed = true;
        let img = pin_element.querySelector('img');
        let img_srcset = img?.srcset || img?.src || '';
        let image_url = img_srcset ? parse_srcset(img_srcset, true) : '';
        let has_video = !!pin_element.querySelector('video');

        if (image_url) {
            // Replaces /736x/, /564x/, /474x/ etc. with /originals/
            image_url = image_url.replace(/\/[\d]+x\//, '/originals/');
        }

        if (!image_url && !has_video) {
            logger('WARN', `Could not find any image or video for pin: ${url}`);
            continue;
        }

        selected_pins.set(url, { url, image_url, media_urls: [], has_video, timestamp: Date.now() });
        inject_selected_overlay(overlay_host, status, subtle);
    }

    if (selection_changed) {
        update_currently_selected_pins();
        if (!endless_mode_active) {
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.selection_success);
        }
    }
}

function update_currently_selected_pins() {
    let pin_count = selected_pins?.size || 0;
    let formatted_pin_count;
    if (pin_count >= 1_000_000_000) formatted_pin_count = `${(pin_count / 1_000_000_000).toFixed(2)}B`;
    else if (pin_count >= 1_000_000) formatted_pin_count = `${(pin_count / 1_000_000).toFixed(2)}M`;
    else if (pin_count >= 1_000) formatted_pin_count = `${(pin_count / 1_000).toFixed(2)}k`;
    else formatted_pin_count = `${pin_count}`;

    const count_el = DOM.full_ui_wrapper.selected_pins_wrapper.currently_selected_pins_count_elem.self;
    const prev_text = count_el ? count_el.textContent : '';

    update_element_html(count_el, formatted_pin_count);

    // Animate the counter only when the value actually changes
    if (count_el && window.gsap && formatted_pin_count !== prev_text) {
        gsap.fromTo(count_el,
            { scale: 1.28, opacity: 0.6 },
            { scale: 1, opacity: 1, duration: 0.32, ease: 'back.out(2.5)' }
        );
    }

    logger('DEBUG', `UI updated to show ${pin_count} selected pins.`);
    sync_minimized_summary();
}

function sync_minimized_summary() {
    const badge = document.querySelector('#cc_minimized_summary_badge');
    if (!badge) return;
    const count = selected_pins.size;
    
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : count;
        if (window.gsap && badge.style.display === 'none') {
            gsap.fromTo(badge, { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, display: 'block', duration: 0.25, ease: 'back.out(3)' });
        } else {
            badge.style.display = 'block';
        }
    } else {
        if (window.gsap && badge.style.display === 'block') {
            gsap.to(badge, { opacity: 0, scale: 0.5, duration: 0.15, ease: 'power2.in', onComplete: () => badge.style.display = 'none' });
        } else {
            badge.style.display = 'none';
        }
    }
}

function unselect_pins(pin_urls, random = true) {
    pin_urls = clean_pin_urls(pin_urls);
    let removal_count = 0;

    for (let url of new Set(pin_urls)) {
        selected_pins.delete(url);
        const pin_element = get_pin_element_by_url(url);
        if (!pin_element) continue;

        const overlayHost = pin_element.querySelector('a[href*="/pin/"]') || pin_element.querySelector('[data-test-id="visual-content-container"]');
        if (!overlayHost) continue;

        let overlay = overlayHost.querySelector('[data-selected-overlay]');
        if (overlay) {
            if (window.gsap) {
                let duration = random ? (0.28 + Math.random() * 0.1) : 0.18;
                gsap.to(overlay, {
                    opacity: 0, scale: 0.94, duration, ease: 'power2.in',
                    onComplete: () => { if (overlay.parentNode) overlay.remove(); }
                });
            } else {
                let duration_ms = random ? (300 + Math.random() * 100) : 150;
                overlay.style.transition = `opacity ${duration_ms}ms ease-in-out`;
                overlay.style.opacity = '0';
                setTimeout(() => { overlay.remove(); }, duration_ms);
            }
            removal_count++;
        }
    }

    if (removal_count > 0) update_currently_selected_pins();

    if (!endless_mode_active) {
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.clear);
    }
}

function clean_pin_urls(urls) {
    return urls
        .filter(url => typeof url === 'string' && url.length > 0)
        .map(url => url.match(/pin\/[^/]+\/?/)?.[0]?.replace(/\/$/, ''))
        .filter(Boolean);
}

function parse_srcset(srcset, best_quality = true) {
    if (typeof srcset !== 'string' || !srcset) return null;

    let urls = srcset.split(',').map(part => part.trim().replace(/\s+\d+[wx]$/, ''))
        .filter(url => url && url.includes('pinimg.com'));

    if (urls.length === 0) return null;

    if (best_quality) {
        urls.sort((a, b) => {
            if (a.includes('/originals/')) return -1;
            if (b.includes('/originals/')) return 1;
            const aRes = a.match(/\/(\d+)x\//)?.[1] || 0;
            const bRes = b.match(/\/(\d+)x\//)?.[1] || 0;
            return parseInt(bRes) - parseInt(aRes);
        });
    }
    return urls[0] || null;
}

function get_folder_name() {
    if (!check_if_board_page()) return "Pinterest_Downloads";
    let path = window.location.pathname.replace(/^\/|\/$/g, '');
    let parts = path.split('/');
    if (parts.length >= 2) {
        let folder = parts.slice(1).join('/');
        return folder.replace(/[\\?%*:|"<>]/g, '-');
    }
    return "Pinterest_Downloads";
}

async function download_pins(items) {
    cancel_downloads = false;
    logger('INFO', `cancel_downloads reset. Value is now: ${cancel_downloads}`);
    logger('INFO', `Starting download of ${items.length} files. This may take a moment...`);
    let failed_downloads = 0;
    let successful_downloads = 0;

    const folder_name = get_folder_name();

    // Deduplicate items based on media_url to prevent downloading identical files (e.g. pin_1234 (1).jpg)
    const unique_items = [];
    const seen_urls = new Set();
    let duplicates_skipped = 0;
    
    for (const item of items) {
        const globally_downloaded = stateful_mode && downloaded_media_urls.has(item.media_url);
        
        if (!globally_downloaded && !seen_urls.has(item.media_url)) {
            seen_urls.add(item.media_url);
            unique_items.push(item);
        } else {
            // It's a duplicate video/media! Instead of completely dropping the pin and losing the item count,
            // fall back to its thumbnail image (which should be unique to the pin).
            if (item.image_url && !seen_urls.has(item.image_url)) {
                seen_urls.add(item.image_url);
                item.media_url = item.image_url;
                unique_items.push(item);
                logger('WARN', `Duplicate media URL skipped, falling back to thumbnail image for pin ${item.pin_url}`);
            } else {
                duplicates_skipped++;
                if (stateful_mode) {
                    downloaded_pins.add(item.pin_url);
                }
            }
        }
    }
    
    if (duplicates_skipped > 0) {
        logger('INFO', `Skipped ${duplicates_skipped} duplicate media URLs found in this batch.`);
    }

    const chunks = [];
    for (let i = 0; i < unique_items.length; i += MAX_CONCURRENT_DOWNLOADS) {
        chunks.push(unique_items.slice(i, i + MAX_CONCURRENT_DOWNLOADS));
    }

    for (let i = 0; i < chunks.length; i++) {
        if (cancel_downloads && !endless_mode_active) {
            logger('WARN', 'Download process was cancelled by the user.');
            break;
        }

        const chunk = chunks[i];
        // Add a small delay between chunks to let the browser breathe (fixes large board freeze)
        if (i > 0) await new Promise(r => setTimeout(r, 200));

        const promises = chunk.map(async (item) => {
            try {
                if (item.media_url.includes('.m3u8')) {
                    logger('WARN', `Skipping HLS stream which cannot be downloaded directly: ${item.media_url}`);
                    return false;
                }
                let fileName = item.media_url.split('/').pop().split('?')[0] || `pin_${Date.now()}`;
                if (item.slide_index) {
                    const parts = fileName.split('.');
                    if (parts.length > 1) {
                        const ext = parts.pop();
                        fileName = `${parts.join('.')}_slide_${item.slide_index}.${ext}`;
                    } else {
                        fileName = `${fileName}_slide_${item.slide_index}`;
                    }
                }
                const full_filename = `${folder_name}/${fileName}`;

                const response = await new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                        { action: "download_pin", url: item.media_url, filename: full_filename },
                        (res) => resolve(res)
                    );
                });

                if (!response || !response.success) {
                    throw new Error(response ? response.error : 'Unknown download error');
                }

                downloaded_pins.add(item.pin_url);
                downloaded_media_urls.add(item.media_url);
                failed_pins.delete(item.pin_url);
                return true;
            } catch (error) {
                logger('ERROR', `Download failed for ${item.media_url}`, error);
                failed_pins.add(item.pin_url);
                return false;
            }
        });

        const results = await Promise.all(promises);
        successful_downloads += results.filter(r => r).length;
        failed_downloads += results.filter(r => !r).length;
        mark_visible_pins_only();

        const progress_percentage = Math.min(100, (((i + 1) * MAX_CONCURRENT_DOWNLOADS / items.length) * 100));

        // Only show percentage log if NOT in endless mode (endless mode has its own status)
        if (!endless_mode_active) {
            DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
            update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, `${message_template.download_progress}: ${progress_percentage.toFixed(0)}%`);
        }
    }

    if (failed_downloads > 0) {
        logger('WARN', `${failed_downloads} out of ${items.length} downloads failed. ${successful_downloads} succeeded.`);
    }
    return { failed_downloads, successful_downloads };
}

function check_if_board_page() {
    const url = window.location.href;
    // Board pages have this pattern: /username/board-name/ or /username/board-name/section-name/
    const is_board = url.match(/pinterest\.com\/[^\/]+\/[^\/]+\/?(?:[^\/]+\/?)?$/) &&
        !url.includes('/pin/') &&
        !url.includes('/search/') &&
        !url.includes('/ideas/') &&
        url !== 'https://www.pinterest.com/' &&
        url !== 'https://za.pinterest.com/' &&
        url !== 'https://pinterest.com/';
    return !!is_board;
}

// Detects URL changes and refreshes UI
function setup_url_change_detection() {
    current_board_url = window.location.href;
    is_on_board_page = check_if_board_page();

    // Method 1: Monitor URL changes via history API
    const original_pushState = history.pushState;
    const original_replaceState = history.replaceState;

    history.pushState = function (...args) {
        original_pushState.apply(this, args);
        handle_url_change();
    };

    history.replaceState = function (...args) {
        original_replaceState.apply(this, args);
        handle_url_change();
    };

    window.addEventListener('popstate', handle_url_change);

    // Method 2: Fallback polling for URL changes (catches edge cases)
    setInterval(() => {
        if (window.location.href !== current_board_url) {
            handle_url_change();
        }
    }, 1000);

    logger('INFO', 'URL change detection is now active.');
}

// Handles navigation between any pages
function handle_url_change() {
    const new_url = window.location.href;
    if (new_url === current_board_url) return;

    logger('INFO', `Detected navigation from ${current_board_url} to ${new_url}`);
    current_board_url = new_url;

    // Stop endless mode on navigation
    if (endless_mode_active) stop_endless_mode();

    const now_on_board = check_if_board_page();
    const was_on_board = is_on_board_page;
    is_on_board_page = now_on_board;

    // If UI is open, handle the transition
    if (DOM.full_ui_wrapper.self && document.body.contains(DOM.full_ui_wrapper.self)) {
        if (now_on_board) {
            logger('INFO', 'Navigated to a board/section. Refreshing UI...');
            refresh_ui_for_new_board();
        } else {
            logger('INFO', 'Navigated away from board page. Disabling board-specific features...');
            disable_board_features();
        }
    }

    // Update button visibility based on page type
    if (DOM.downloader_button.self) {
        if (now_on_board) {
            DOM.downloader_button.self.classList.remove('cc_hidden');
        } else {
            // Keep button visible but you could hide it if you want
            // DOM.downloader_button.self.classList.add('cc_hidden');
        }
    }
}

function disable_board_features() {
    // Stop any ongoing operations
    if (observer_running) cancel_downloads = true;
    clearInterval(timeout_watcher_interval);
    clearInterval(auto_scroll_interval);
    observer?.disconnect();
    observer = null;
    observer_running = false;

    // Clear visual overlays
    document.querySelectorAll('[data-selected-overlay]').forEach(e => e.remove());

    // Update UI to show we're not on a board
    if (DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self) {
        DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self.innerHTML = 'N/A';
    }

    // Reset progress log to clear state (no warning needed)
    DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
    update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.clear);

    logger('INFO', 'Board features disabled - not on a board page.');
}

function refresh_ui_for_new_board() {
    // Stop any ongoing operations
    if (observer_running) cancel_downloads = true;
    clearInterval(timeout_watcher_interval);
    clearInterval(auto_scroll_interval);
    observer?.disconnect();
    observer = null;
    observer_running = false;

    // Clear visual overlays from previous board
    document.querySelectorAll('[data-selected-overlay]').forEach(e => e.remove());

    // Clear selections if stateful mode is off
    if (!stateful_mode) {
        selected_pins.clear();
        update_currently_selected_pins();
    } else {
        // Re-mark pins that are visible on this page
        mark_visible_pins_only();
    }

    // Wait a bit for page to load, then update pin count
    setTimeout(() => {
        let pin_count = get_board_pin_count();

        if (pin_count?.pin_count >= 0) {
            update_element_html(DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self, pin_count.formatted_pin_count);
            logger('INFO', `Detected ${pin_count.pin_count} total pins on this board/section.`);
        } else {
            DOM.full_ui_wrapper.board_count_wrapper.current_board_count_elem.self.innerHTML = 'N/A';
            logger('WARN', 'Could not find the total pin count for this board/section.');
        }

        // Reset progress log
        DOM.full_ui_wrapper.progress_log_elem.self.className = 'cc_log';
        update_element_html(DOM.full_ui_wrapper.progress_log_elem.self, message_template.clear);

        logger('INFO', 'UI refreshed for new board/section.');
    }, 500);
}

function get_board_pin_count() {
    logger('DEBUG', 'Attempting to find the total pin count for this board/section...');
    const pinCountRegex = /[\d,]+\s*pin/i;

    // Try multiple selectors for different board types
    let pin_count_element = document.querySelector('[data-test-id="pin-count"]') ||
        document.querySelector('[data-test-id="board-section-pin-count"]') ||
        document.querySelector('[data-test-id="board-header-stats"]');

    let pin_count_text = pin_count_element?.innerText || document.body.innerText.match(pinCountRegex)?.[0];
    if (!pin_count_text) return null;

    let pin_count = parseInt(pin_count_text.replace(/[,\sA-Za-z]/g, ''));
    if (!Number.isInteger(pin_count)) return null;

    let formatted_pin_count;
    if (pin_count >= 1_000_000_000) formatted_pin_count = `${(pin_count / 1_000_000_000).toFixed(2)}B`;
    else if (pin_count >= 1_000_000) formatted_pin_count = `${(pin_count / 1_000_000).toFixed(2)}M`;
    else if (pin_count >= 1_000) formatted_pin_count = `${(pin_count / 1_000).toFixed(1)}k`;
    else formatted_pin_count = `${pin_count}`;

    return { pin_count, formatted_pin_count };
}

function html_to_element(htmlString) {
    const template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    return template.content.firstChild;
}

function update_element_html(element, value = '') {
    if (!element) return;
    try {
        element.innerHTML = value;
    } catch (err) {
        logger('ERROR', `Failed to update a UI element.`, { original_error: err });
    }
}

function close_full_ui() {
    logger('INFO', 'Closing the downloader UI...');
    cancel_downloads = true;
    endless_mode_active = false;
    document.body.style.userSelect = '';

    document.removeEventListener('contextmenu', handle_click);
    document.removeEventListener('scroll', mark_visible_pins_only);
    document.removeEventListener('drop', mark_visible_pins_only);
    window.removeEventListener('resize', mark_visible_pins_only);

    document.removeEventListener('mousedown', handle_marquee_start);
    document.removeEventListener('mousemove', handle_marquee_move);
    document.removeEventListener('mouseup', handle_marquee_end);
    document.removeEventListener('mouseleave', cleanup_marquee);
    document.removeEventListener('contextmenu', handle_marquee_end_on_contextmenu);

    clearInterval(timeout_watcher_interval);
    clearInterval(auto_scroll_interval);
    observer?.disconnect();
    observer = null;
    observer_running = false;

    unselect_pins(Array.from(selected_pins.keys()));
    document.querySelectorAll('[data-selected-overlay]').forEach(e => e.remove());

    localStorage.setItem('downloaded_pins', JSON.stringify([...downloaded_pins]));
    localStorage.setItem('downloaded_media_urls', JSON.stringify([...downloaded_media_urls]));
    logger('INFO', `Saved download history of ${downloaded_pins.size} pins.`);

    selected_pins.clear();
    failed_pins.clear();

    const ui_el = DOM.full_ui_wrapper.self;
    const btn_el = DOM.downloader_button.self;

    function finish_close() {
        if (ui_el && ui_el.parentNode) ui_el.remove();
        const tt = document.getElementById('cc_help_tooltip');
        if (tt) tt.remove();
        btn_el.style.display = '';
        let downloader_button = btn_el;
        DOM = DOM_template;
        DOM.downloader_button.self = downloader_button;
        logger('INFO', 'Downloader UI is now closed.');
    }

    if (window.gsap && ui_el) {
        gsap.to(ui_el, {
            opacity: 0,
            y: 40,
            duration: 0.35,
            ease: 'power3.in',
            onComplete: finish_close
        });
    } else {
        finish_close();
    }
}