# Canvas Quiz Bank Exporter - Installation & Usage Guide

## Installation

### Chrome / Edge / Brave (Chromium-based browsers)

1. Download or clone this repository
2. Open your browser and navigate to the extensions page:
   - **Chrome**: `chrome://extensions`
   - **Edge**: `edge://extensions`
   - **Brave**: `brave://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` folder from this repository
6. The extension icon should appear in your browser toolbar

### Firefox

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside the `extension/` folder (e.g., `manifest.json`)

> **Note**: Firefox temporary extensions are removed when the browser closes.

---

## Usage

### Exporting Question Banks

1. Navigate to your Canvas LMS instance
2. Open a **Quiz** or **Item Bank** page
3. Click the extension icon in your browser toolbar
4. The extension will automatically detect the bank type:
   - **Classic Quiz** - Traditional Canvas quiz question banks
   - **New Quizzes Item Bank** - Newer Canvas quiz system
5. Click **Export** to download the questions as JSON

### Supported Pages

| Page Type | URL Pattern | Export Format |
|-----------|-------------|---------------|
| Classic Quiz | `/courses/.../quizzes/.../edit` | Classic (v1.0) |
| Item Bank | `/courses/.../question_banks/...` | Item Bank (v2.2) |
| New Quizzes | `/courses/.../assignments/.../edit` | Item Bank (v2.2) |

### Export Output

Exports are saved as JSON files with the following naming convention:
- `[bank-name]_[timestamp].json`

See [EXPORT_SCHEMA.md](./EXPORT_SCHEMA.md) for detailed schema documentation.

---

## Troubleshooting

### Extension not detecting bank

- Ensure you're on a supported Canvas page (see table above)
- Refresh the page and try again
- Check that the extension has permission to access the current site

### Export button not appearing

- Wait for the page to fully load
- The extension shows a loading shimmer while detecting the bank type

### Permission errors

- Some Canvas instances may require additional permissions
- Contact your Canvas administrator if access is restricted

---

## Development

To modify the extension:

1. Make changes to files in the `extension/` folder
2. Go to your browser's extensions page
3. Click the **Reload** button on the extension card
4. Test your changes

### Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration |
| `popup.html/js` | Extension popup UI |
| `content-script.js` | Injected into Canvas pages |
| `background.js` | Service worker for background tasks |
| `inject.js` | Injected script for page context access |
| `utils.js` | Shared utility functions |
