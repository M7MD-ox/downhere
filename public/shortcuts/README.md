# DownMe — iOS Apple Shortcut Guide

This directory contains the official Apple Shortcut definition for **DownMe**, enabling native iOS and iPadOS integration via the system Share Sheet.

---

## 1. Overview & Architecture

Because iOS Safari does not natively expose the W3C Web Share Target API to third-party native apps in the system Share Sheet, this Apple Shortcut acts as the native bridge between iOS apps (YouTube, Facebook, TikTok, Pinterest) and DownMe.

### Shortcut Execution Modes:
When you share a media link and select **DownMe**, you are presented with a minimalist two-option menu:

1. **"Open in DownMe"** (Interactive Web Experience):
   - Encodes the incoming URL.
   - Launches the DownMe PWA (`https://downme.app/?url=<encoded_url>`).
   - Automatically inputs the URL and initiates media stream analysis.
   - Allows previewing, format selection (1080p, 720p, MP3 320k, M4A, Subtitles), and in-app video trimming.

2. **"Save to Camera Roll"** (One-Tap Direct Download):
   - Requests the highest-quality stream (`formatId=hd`, `mediaType=video`) directly from the backend.
   - Downloads the file contents directly on the device.
   - Saves the resulting MP4 video or photo straight to your iPhone **Camera Roll (Photos > Recents)**.
   - Shows an iOS system notification confirming completion.

---

## 2. Installation on iOS / iPadOS

### Method A: Install via File / AirDrop
1. AirDrop or download `DownMe.shortcut` to your iPhone or iPad.
2. Tap the file in the **Files** app.
3. iOS will automatically open the **Shortcuts** app and display the shortcut details.
4. Tap **"Add Shortcut"**.

### Method B: Configure Manually in Apple Shortcuts
If you prefer building the shortcut manually:
1. Open the **Shortcuts** app on iOS.
2. Create a new shortcut titled **DownMe**.
3. Tap the **(i)** Info button at the bottom and enable **"Show in Share Sheet"**.
4. Set Share Sheet types to: **URLs**, **Safari web pages**, **Text**.
5. Add the following action chain:
   - **Get URLs from Input** (`Shortcut Input`)
   - **Choose from Menu** with items:
     * `Open in DownMe`
     * `Save to Camera Roll`
   - Under **Open in DownMe**:
     * **URL Encode** (`Input URL`)
     * **Text**: `https://downme.app/?url=[Encoded URL]`
     * **Open URLs** (`Text`)
   - Under **Save to Camera Roll**:
     * **URL Encode** (`Input URL`)
     * **Get Contents of URL**: `https://downme.app/api/download?url=[Encoded URL]&formatId=hd&mediaType=video`
     * **Save to Photo Album** (`Contents of URL`)
     * **Show Notification**: "Media successfully saved to Camera Roll with DownMe."

---

## 3. How to Use

1. Open any media item in:
   - **YouTube** (Videos, Shorts)
   - **Facebook** (Videos, Reels)
   - **TikTok** (Videos, Photo carousels)
   - **Pinterest** (Pins, Idea Pins, Animated GIFs)
2. Tap the native **Share** button (arrow or `...` menu).
3. Select **DownMe** (or tap **More** if not immediately visible).
4. Choose:
   - **"Open in DownMe"** to customize quality, trim clips, or preview.
   - **"Save to Camera Roll"** to immediately save the highest-quality file into Photos.

---

## 4. Privacy & Technical Specifications
- **Client Version**: 2104.0.4 (iOS 14.0 - iOS 18+)
- **Icon**: Download Arrow glyph (`59744`), Deep Apple Blue (`#0071E3`)
- **Permissions**: Standard Safari URL launching and Photo Library write permissions. No analytics, tracking, or telemetry.
