# Delivery

How an order gets from the print shop to the customer. Code: `src/lib/delivery/*`,
`src/lib/partnerOrderTransitions.ts`, `src/components/order/DeliveryChooser.tsx`.

## Three ways, chosen per shop

| | Pickup | Shop delivers | Courier |
|---|---|---|---|
| Who offers it | Every shop | Shops that turn it on | Shops that turn it on |
| Where | At the shop or one of its delivery points | Within the shop's radius (default 3 km) | Anywhere Shiprocket serves |
| Price | Free | The shop's own fee | Shiprocket rate from the shop's pincode |
| Who gets the delivery money | – | The shop, all of it | The platform (it pays Shiprocket) |
| Steps after printing | Ready for pickup → Collected | Out for delivery → Delivered (needs the code) | Book courier → Out for delivery → Delivered (tracking) |

Both delivery options are **off by default**, because not every shop delivers. A shop
with both off is pickup only, and the shop list says so. Shops change this on the
partner dashboard: Shop → Home delivery.

The shop's share is 90% of the printing, plus its whole delivery fee when it delivers
itself (`partnerShareOf` in `src/lib/payments/money.ts`).

## Shop delivers

- Offered only when the customer shares their location and is inside the radius.
  Checkout checks this again on the server (`getDeliveryOptions`).
- Each order gets a random 4-digit **handover code**. The customer sees it in My orders,
  the order page and the invoice email. The shop's apps never receive it
  (`forPartner`); they only learn whether it is required and accepted.
- The shop marks the order delivered by entering the code. After 5 wrong codes the
  order is locked and support has to confirm the delivery.

## Courier (Shiprocket)

- Each approved shop with courier on is registered as **its own Shiprocket pickup
  address** (`ensureCourierPickup`, POST `/settings/company/addpickup`). The nickname
  includes a hash of the address, so a new shop address registers a new pickup.
  Shiprocket asks to verify a new pickup phone number the first time it is used.
- Quotes come from the shop's pincode. Only speeds a real courier offers are shown.
- After printing, the shop presses **Book courier** in any app (or an admin does).
  `bookCourier` creates the Shiprocket order and assigns the AWB, with a lock against
  double bookings. If the AWB step fails, a retry only repeats that step.
- Tracking: Shiprocket calls `/api/webhooks/courier-updates`. Set it up in Shiprocket →
  Settings → API → Webhooks with the URL `https://<site>/api/webhooks/courier-updates`
  and the token `SHIPROCKET_WEBHOOK_TOKEN`. Shiprocket forbids "shiprocket", "sr" and "kr"
  in the URL, hence the name.

## Environment

`SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` (an API user from Shiprocket → Settings → API),
`SHIPROCKET_WEBHOOK_TOKEN`, optional `SHIPROCKET_DEFAULT_WEIGHT`. Without credentials,
couriers are quoted with a weight estimate and cannot be booked (local development).

## Later

Rider companies (Shadowfax, Shiprocket Quick, Pidge) can be added as another option
in `getDeliveryOptions`, city by city.
