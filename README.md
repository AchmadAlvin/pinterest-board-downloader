# Pinterest Board & Pin Downloader (Modified)

> **This project is a modified fork of [rrokutaro/pinterest-board-downloader](https://github.com/rrokutaro/pinterest-board-downloader).** All credit for the original codebase goes to the original author. This version includes additional features and UI improvements listed below.

![Hero](./readme-assets/download.png)

## What's New in This Fork

### 🎬 Video & GIF Downloads
The original extension only supports image downloads. This fork adds **full video and GIF download support**, automatically detecting video pins and fetching the highest quality `.mp4` source via the Pinterest API.

### 🖼️ Carousel & Story Pin Support
Pinterest pins can contain multiple images (Carousel) or multiple video/image slides (Story Pins). This fork **extracts every single slide** from these multi-media pins and downloads them all, with automatic naming (`_slide_1.jpg`, `_slide_2.jpg`, etc.).

### 📁 Automatic Folder Organization
When downloading from a board, all files are now **automatically saved into a subfolder** named after the board. For example, downloading from `pinterest.com/user/my-board` will save files into `Downloads/my-board/`. This uses the `chrome.downloads` API via a background service worker for better performance and path control.

### ⚡ Improved Download Engine
Downloads have been migrated from in-memory `Blob` fetching to the **`chrome.downloads` API**. This significantly reduces memory usage when downloading hundreds of pins and prevents browser tab crashes on large boards.

### 🎨 Minimal Floating UI
The extension UI has been redesigned into a **compact floating action button** (44×44px) positioned at the bottom-center of the screen. It expands into a full control panel with smooth GSAP animations when clicked, and shrinks back to a tiny icon when minimized — with a badge showing the number of selected pins.

### 🚀 Rate-Limited API Extraction
To prevent Pinterest from temporarily blocking your account, media extraction is **batched in groups of 5 concurrent requests**, ensuring safe bulk downloads even for boards with hundreds of pins.

---

## Original Features

*   **Download Entire Boards**: Easily download all pins from any Pinterest board you're viewing.
*   **Individual Pin Selection**: Hover over any pin to select it and add it to your download queue.
*   **Select All Visible Pins**: Quickly grab all pins currently displayed on your screen.
*   **Best Image Quality**: Get the highest resolution images available for crisp, clear downloads.
*   **Skip Already Downloaded Pins**: Avoid duplicates by automatically skipping pins you've already downloaded (enabled by default).
*   **Download in Batches**: Experience smoother performance with downloads processed in smaller batches.
*   **History Management**:
    *   **Import & Export History**: Easily back up and transfer your download history using a JSON file.
    *   **Clear History**: Start fresh by clearing your entire download history with a single click.
*   **Minimized View**: A more compact interface option.
*   **Improved Memory Management**: Prevents slowdowns during long downloads by clearing old pins.
*   **Endless Mode**: Fully automatic — endlessly scrolls, loads, selects, and downloads pins in batches.

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/` in your browser.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `browser-extension` folder.
5. Navigate to any Pinterest board and click the floating Pinterest icon at the bottom of the screen.

## License

This project inherits the license from the [original repository](https://github.com/rrokutaro/pinterest-board-downloader). Please refer to the original project for license details.
