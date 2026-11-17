# Business Blueprint: FunPrinting Partner Apps (PC & Mobile)

**Core Philosophy:** We are building a high-volume, enterprise-grade printing platform. The franchise partners are common shopkeepers who are NOT software engineers. They need foolproof, standalone applications (`.exe` for Windows, `.apk` for Android) that require zero technical configuration, never crash silently, and handle revenue tracking securely. 

This document defines the actionable phases to finalize the Partner Applications. Every phase MUST include both Backend (Node.js/Cloud/Native) and Frontend (React/React Native) implementations, adhering strictly to the premium dark-mode web app theme.

---

## Phase 1: Native Print Tunnel Initialization (Completed)
**Goal:** Establish the fundamental architecture that bypasses standard web browsers to communicate directly with physical hardware.
- **Backend:** Cloud Socket.IO broker (`/wss`) routing JWT-authenticated jobs.
- **Frontend:** Basic Electron `.exe` (Windows) and Expo `.apk` (Android) UI shells with dark-mode login screens.

---

## Phase 2: Mobile Persistence & Offline Resilience
**Goal:** A true business app does not log out the shopkeeper every time they close the app. It must maintain session state securely and handle network drops.
- **Backend (React Native / Expo):** 
  - Integrate `expo-secure-store` to securely cache the Partner's JWT token on the device hardware.
  - Implement WebSocket auto-reconnect logic with exponential backoff if the 4G/5G connection drops.
- **Frontend (Mobile UI):**
  - Add a persistent "Network Status" indicator (Green = Connected, Red = Disconnected) in the header.
  - Build an "App Booting" splash screen that verifies the SecureStore token silently before dropping the user into the Dashboard.

---

## Phase 3: Hardware Queue Management (PC & Mobile)
**Goal:** Shopkeepers need to see what is printing, what is jammed, and what was completed. No fake data—we read the actual hardware spooler state.
- **Backend (OS Integration):**
  - *PC:* Refine the `lpstat`/PowerShell daemon to report exactly when a job leaves the spooler.
  - *Mobile:* Track the `expo-print` job promises. If Android throws a print error (out of paper), catch it.
- **Frontend (Queue UI):**
  - Build a live, auto-updating Kanban board inside the PC and Mobile apps (Columns: Incoming, Printing, Completed, Failed).
  - Add physical error alerts (e.g., screen flashes red) if the printer goes offline or jams.

---

## Phase 4: Order Lifecycle & Status Control
**Goal:** Once a document prints, the shopkeeper must inform the platform (and the customer) that it is ready for pickup.
- **Backend (Cloud API):**
  - Create a secure `PATCH /api/partner/orders/[id]/status` endpoint to advance order states (`printing` -> `ready_for_pickup` -> `completed`).
- **Frontend (App UI):**
  - Add interactive buttons to the Kanban board: "Mark as Ready for Pickup" and "Mark as Delivered".
  - Ensure these buttons trigger immediate WebSocket updates so the Customer Web Dashboard updates live.

---

## Phase 5: Shopkeeper Financial Dashboard
**Goal:** Partners need to see exactly how much money they have made today (the 90% payout) to trust the platform.
- **Backend (Cloud API):**
  - Expose a `GET /api/partner/financials` endpoint calculating daily and monthly revenue exclusively for the logged-in partner's Razorpay split.
- **Frontend (App UI):**
  - Build a highly polished, dark-themed Revenue Analytics screen inside the PC and Mobile apps.
  - Show "Today's Earnings (90% Split)" prominently.

---

## Phase 6: Automated CI/CD Release Pipeline
**Goal:** Shopkeepers don't know how to compile code. We must deliver `.exe` and `.apk` files automatically over the cloud.
- **Backend (GitHub Actions):**
  - Configure `electron-builder` in `.github/workflows` to compile the Windows `.exe` on every `git tag`.
  - Configure `eas build` (Expo Application Services) to compile the `.apk` on the cloud.
- **Frontend (Web Dashboard Update):**
  - The Web App Partner Dashboard (`/partner/dashboard`) must automatically fetch the latest GitHub Release and display valid "Download .exe" and "Download .apk" buttons so shopkeepers always have the latest version.
