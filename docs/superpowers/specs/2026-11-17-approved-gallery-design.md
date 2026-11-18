# Approved designs gallery

User-approved scope: preserve the existing summary and place a gallery immediately below it. Show exactly the five currently approved versions, labelled with style and version, with the existing enlarged preview, individual full-resolution downloads and a ZIP of all five. Rejected versions are excluded. A rejection invalidates summary and gallery until five current versions are accepted and a new summary exists.

## Approach

Reuse the frontend's authenticated `ImageContext` loader, current-version pointers and preview dialog. Build the ZIP in the browser using fflate, preserving original image bytes and MIME extensions; no server endpoint or schema change. Alternatives were individual downloads only (does not meet agreed ZIP scope) or a server ZIP endpoint (adds unnecessary backend deployment work).

Keep descriptions in the existing cards. Demo shows labelled example thumbnails with previews, without downloads of mockup crops presented as real generated files. Gallery and pending downloads must disappear/cancel on invalidation, project switch, deletion or sign-out. Failed downloads show a recoverable error and never save an incomplete ZIP. Preserve summaries while paused if their revision/accepted IDs remain valid.

Implementation choices: a focused `ApprovedGallery` component and download helpers, filenames `<style>-v<number>.<mime extension>` and a session-specific ZIP name. Abort on unmount; revoke temporary download object URLs after the browser can start saving.
