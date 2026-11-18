# Documents: conversion and stored files

Code: `src/lib/documents/`.

## Downloading stored files (`fileUrls.ts`)

The server downloads files in several places: order files for the viewer, template Word files, and files users upload while creating templates. Many of those URLs come from a request body, or from a database field that was written from one. All of them go through `fetchTrustedFile`, so the server can't be made to fetch internal addresses or other sites (SSRF).

| Rule | Detail |
|---|---|
| Scheme | `https` only, default port, no `user:password@` |
| Hosts | `res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/…`; `objectstorage.<OCI_REGION>.oraclecloud.com` in `OCI_NAMESPACE` / `OCI_BUCKET_NAME` (direct or pre-authenticated URLs); anything listed in `FILE_URL_HOSTS` (`host` or `host/path-prefix`) |
| Redirects | Followed only to allowed hosts, at most 3 |
| Size and time | 50 MB by default (20 MB for templates), 30 s timeout; the body is counted while streaming |
| Errors | `FileFetchError` with the status to return: 400 not our file, 404, 413 too large, 502 storage error |

`isTrustedFileUrl` is also used before a URL is saved (template create and admin save) so only our own files are stored. `decodeBase64File` limits base64 uploads in JSON bodies.

## Converting (`convert.ts`)

| Function | Services, in order |
|---|---|
| `docxToPdf(buffer)` | Cloudmersive → ConvertAPI → iLovePDF → LibreOffice → Render service |
| `pdfToDocx(buffer)` | Cloudmersive → LibreOffice |

A service is used only when it is configured (its keys are set, or LibreOffice is installed). The first success wins; a result that isn't a PDF counts as a failure. If all fail, `ConversionError` lists every attempt (logged). `DOCX_TO_PDF_PROVIDERS` changes the order or drops services.

| Service | Configuration | Notes |
|---|---|---|
| Cloudmersive | `CLOUDMERSIVE_API_KEY` | |
| ConvertAPI | `CONVERTAPI_SECRET` | Secret sent in a header, not the URL; download links must be on `convertapi.com` |
| iLovePDF | `ILOVEPDF_PUBLIC_KEY`, `ILOVEPDF_SECRET_KEY` | Task server must be an `ilovepdf.com` host |
| LibreOffice | installed `soffice` (or `LIBREOFFICE_PATH`) | Not on Vercel. No shell; own temp folder and profile; 90 s timeout |
| Render service | `RENDER_SERVICE_URL` (default fly.dev); `RENDER_SERVICE_DISABLED=1` to turn off | Slowest; the file is uploaded to storage first |

Page counts for uploads (`src/lib/uploads/pageCount.ts`) use only Cloudmersive and LibreOffice, then estimate from the text.

## Template routes

| Route | Access | What it does |
|---|---|---|
| `POST /api/templates/generate-fill-pdf` | Sign-in; paid templates need a purchase | Fills the Word file, returns it and a job id; the PDF is made in the background (`after()`) |
| `GET /api/templates/generation-status/[jobId]` | The user who started the job | Progress, PDF and Word URLs (jobs last an hour) |
| `POST /api/templates/download-filled` | Sign-in | Fills a Word file the user is building a template from |
| `POST /api/extract-placeholders` | Sign-in | Lists `{{placeholders}}` in an uploaded Word file |
| `POST /api/upload-raw-file` | Sign-in | Stores a Word or PDF file (type checked from content, 20 MB) |
| `POST /api/parse-docx-structure` | Anyone; rate-limited | Page count preview for the order page |
| `GET /api/admin/pdf-viewer` | Customers: files of their own order; admins: any of our files | Previews a stored file |

The Word file of a template is the paid product, so its URL is sent only to the template's owner and admins (template lists and `templates/[id]`).

The file viewer shows PDFs and raster images inline. Everything else (SVG, HTML, Word, text) is sent as a download with `X-Content-Type-Options: nosniff`, so an uploaded file can't run scripts on our site.

## Removed in Phase 7

Routes with no callers, or only test scripts: `document-proxy`, `pdf/fetch`, `pdf/upload`, `convert-docx-to-html`, `convert-pdf-to-word`, `convert-word-to-pdf`, `edit-docx-template`, `generate-document`, `generate-personalized-document`, `save-template` (top level), `templates/preview`, `templates/preview-upload`, `templates/generate`, `templates/generate-fill`, `templates/user-download`, `admin/templates` (root), `admin/templates/dynamic` (root and `upload`), `wopi/files/[id]`, `extract-placeholders-range`, `extract-word-info`, `replace-placeholders`. Also `src/lib/pdfGenerator.ts` and the unused async parts of `renderPdfService`.
