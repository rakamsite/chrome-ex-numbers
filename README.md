# Iran Mobile Site Scanner Chrome Extension

A Manifest V3 Chrome extension that saves phone numbers from Torob shop pages, scans visited websites for Iranian mobile phone numbers, email addresses, CMS type, and stores categorized lead records in `chrome.storage.local`.

## Features

- Automatic scan on page load without opening the popup.
- SPA support with `MutationObserver` for React, Vue, Next.js, and similar websites.
- Visible DOM scanning that avoids `script`, `style`, `noscript`, `template`, `svg`, and `canvas` content.
- Iranian mobile extraction from formats such as `09123456789`, `+989123456789`, `989123456789`, `0912 345 6789`, `0912-345-6789`, and `tel:09123456789`.
- Mobile normalization to final `09xxxxxxxxx` format.
- Email extraction with a full email regex.
- CMS detection: `WordPress` when a generator meta tag or `wp-content` asset/link is found; otherwise `Other`.
- Automatic deduplication by domain plus mobile number.
- Category memory through `lastCategory`; new scans use the last user-selected category.
- Popup with current site data, editable/manual mobile numbers, category update, site deletion, rescan, and dashboard launch.
- Dashboard/options page with search, category filter, edit, delete, delete all, CSV UTF-8 export, and CSV UTF-8 import.
- Icon color states: gray inactive/no site, yellow waiting for site scan or Torob shop page without visible number, sky blue two or more mobile numbers found, green exactly one mobile number found, red no mobile found.

## CSV Format

The CSV header must be exactly:

```csv
site_name,site_url,category,mobile,email,cms
```

Exported CSV includes a UTF-8 BOM so spreadsheet tools detect UTF-8 correctly. Mobile values are exported as spreadsheet text formulas, such as `="09123456789"`, so Excel and similar apps do not remove the leading zero.

## Storage Structure

The extension stores this object in `chrome.storage.local`:

```json
{
  "records": [
    {
      "site_name": "Example",
      "site_url": "example.com",
      "category": "Leads",
      "mobile": "09123456789",
      "email": "info@example.com",
      "cms": "WordPress"
    }
  ],
  "lastCategory": "Leads"
}
```

Each mobile number creates one record. If the same domain and mobile already exist, the record is updated instead of duplicated.

## Load Into Chrome

1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `chrome-ex-numbers`.
5. Visit normal `http` or `https` websites. The extension scans automatically.
6. Click the extension icon to view the current page data or open the dashboard.

## File Overview

- `manifest.json` - Manifest V3 configuration.
- `service_worker.js` - Background coordination, icon state, tab scan triggers, storage updates.
- `content-script.js` - DOM scanner, phone/email extraction, CMS detection, SPA observer.
- `utils.js` - Shared regex, normalization, CMS, deduplication, and CSV helpers.
- `storage.js` - `chrome.storage.local` data handling helpers.
- `popup.html`, `popup.css`, `popup.js` - Extension popup UI.
- `options.html`, `options.css`, `options.js` - Dashboard/options UI.
- `icons/` - PNG icon sets for gray, yellow, blue, green, and red states.

## Notes

Chrome blocks content scripts on internal pages such as `chrome://extensions`, Chrome Web Store pages, and some browser-controlled pages. The icon stays gray for those pages.
