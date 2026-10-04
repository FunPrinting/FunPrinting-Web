# Phased Implementation Plan: Fun Printing Marketplace

This document outlines the step-by-step roadmap to build the Fun Printing marketplace. Because this is a **production business application** (not a demo), each phase is designed as a vertical slice—completing both frontend UI and backend logic, with robust error handling, database integrity, and UI consistency matching the current premium theme.

---

## Phase 1: Partner Foundation & Onboarding
**Goal:** Allow users to register as partners and securely store their data.

- **Backend (Next.js APIs & DB):**
  - Create the `Partner` Mongoose Model (fields: `userId`, `businessName`, `location` (GeoJSON), `printers`, `status`, `earnings`).
  - Update the `Order` Model to reference `partnerId` and add detailed statuses (`assigned`, `printing`, `ready`).
  - Extend NextAuth configuration to support a `role` (Customer vs. Partner) and issue JWTs accordingly.
- **Frontend (Web):**
  - Build the `/partner` marketing landing page explaining the franchise benefits.
  - Build the Partner Authentication flow (Sign up, Log in).
  - Build the initial Partner Web Dashboard where they can set their Shop Name, Location (via a map click), and connect their payout bank details.

## Phase 2: Hyperlocal Mapping & Customer Checkout
**Goal:** Customers can visually locate and select a nearby partner to print their documents.

- **Backend (Next.js APIs):**
  - Build a highly-optimized `/api/partners/nearby` route utilizing MongoDB `$near` geospatial queries to return active partners within a dynamic radius (e.g., 5km).
- **Frontend (Web):**
  - Integrate OpenStreetMap (Leaflet.js) into the checkout flow.
  - Build the map interface showing the user's location and custom branded pins for nearby active partners.
  - Build the "Partner Selection" card UI (showing partner distance, estimated time, and pricing).
  - Modify the checkout state to store the selected `partnerId`.

## Phase 3: Financial Routing & Order Dispatch
**Goal:** Ensure money flows correctly between the customer, platform, and partner, and orders are accurately assigned.

- **Backend (Next.js APIs):**
  - Integrate **Razorpay Route** (Split Payments). When an order is created, automatically split the transaction: take the Platform Commission and route the rest to the Partner's connected Razorpay account.
  - Update Webhook handlers to confirm payment and mark the specific `partnerId` order as `paid`.
- **Frontend (Web):**
  - Build the "Order Success" page that now displays the assigned Partner's details.
  - Implement the "Navigate to Partner" button that generates the Google Maps turn-by-turn URL.

## Phase 4: Admin Control Center Revamp
**Goal:** Give the platform owner a bird's-eye view of the entire franchise network.

- **Backend (Next.js APIs):**
  - Build aggregation pipelines in MongoDB to calculate daily/monthly revenue per partner, active partner counts, and platform commissions.
- **Frontend (Web):**
  - Rebuild the Admin Dashboard entry page to display a grid of **Partner Cards** (showing status, revenue, and active orders).
  - Build the drill-down view: Clicking a partner card opens a detailed view of *only* that partner's orders, hardware status, and error logs.

## Phase 5: The Real-time Cloud Engine (WebSockets)
**Goal:** Establish the zero-config tunneling architecture to talk to partner hardware.

- **Backend (Node.js/Socket.io):**
  - Implement a secure WebSocket server.
  - Create an authentication middleware that verifies the Partner's JWT before allowing a WebSocket connection.
  - Build the event dispatcher: Once Razorpay confirms a payment (Phase 3), emit a `new_print_job` event exclusively to the specific partner's active socket room.

## Phase 6: Partner Desktop App (Foundation & Hardware)
**Goal:** Build the Electron `.exe` that partners install on their machines.

- **App Core (Electron + React):**
  - Initialize the Electron app with a premium, dark-mode matching UI.
  - Build the Login Screen using the web JWT system.
- **Background Daemon (Node.js):**
  - Integrate the WebSocket client to maintain a persistent, auto-reconnecting connection to the Phase 5 cloud server.
  - Implement OS-level hardware discovery (`lpstat`, `Get-Printer` via PowerShell) to auto-detect physical USB/WiFi printers.
- **Frontend (Renderer):**
  - Build the UI to show detected printers and allow the partner to toggle their status to "Online" (which syncs to the cloud DB).

## Phase 7: The "AIMD" Printing Engine (Error Control)
**Goal:** Ensure flawless, jam-resistant printing using TCP Congestion Control logic.

- **Background Daemon (Node.js):**
  - Implement `pdf-lib` to dynamically slice incoming PDFs.
  - Build the **AIMD Sliding Window Protocol**:
    - Start by sending a batch of 5 pages.
    - Poll the OS Print Spooler. If ACKed (success), increase batch size to 10.
    - If NACKed (Paper Jam/Error), drop batch size to 1, halt the queue, and alert the UI.
- **Frontend (Renderer):**
  - Build the live Print Queue UI (progress bars, page indicators).
  - Build the Error Alert system (flashing red screen for Paper Jams) with a physical "Resume Printing" button that triggers the 1-page error recovery loop.
