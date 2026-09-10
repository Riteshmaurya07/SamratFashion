# Custom Printing Request Flow

## Customer flow

`/custom-printing` loads active catalog products through `GET /api/catalog/customizable-products`; it does not maintain a separate custom-product list. The selected variant remains the product API's authority for color, size, SKU, availability, stock, and base price.

Customers can either:

- choose **Design it yourself**, which preserves `/custom-designer` and the existing `CustomDesign` canvas/cart flow; or
- submit a **Custom Printing Request** without a finished design.

The request form supports:

1. Product selection without navigation.
2. Variant-backed color and size selection.
3. Supported print locations only: `FRONT` and `BACK`. Multiple locations are allowed.
4. Optional logo/artwork upload through `POST /api/uploads/image` with `category=custom-artwork`.
5. Required, trimmed instructions capped at 2,000 characters.
6. A preview summary and a no-logo design-assistance message.

Requests require an authenticated customer. The current account identity is used; guest authentication is not weakened.

## Backend flow

`POST /api/designs/requests` reuses the `CustomDesign` collection with `requestType=PRINTING_REQUEST`, `status=REQUESTED`, and empty canvas elements. It validates the active customizable product, verifies that the selected variant belongs to the product, checks availability/stock, and checks color/size against the variant. It does not create a retail `Order`, payment, inventory transaction, or `PrintJob`.

`HAS_ARTWORK` and `NEEDS_DESIGN_ASSISTANCE` are represented by `artworkType`. Artwork is stored as an existing ImageService result (`url`, optional `publicId`, and format); the UI never imports Cloudinary. A client idempotency key is scoped to the customer and prevents duplicate request creation.

## Admin flow

`/admin/custom-orders` combines paid custom order records and `PRINTING_REQUEST` records. Request rows show customer, product, color, size, placement, artwork presence, instructions, and `REQUESTED` state. The detail view is read-only for request records and explicitly displays `No artwork provided — design assistance requested.` Admin routes retain `requireAuth` and `requireRole("ADMIN", "SUPER_ADMIN")`.

Requests remain in review. An admin must not treat them as `READY_FOR_PRINT`; production `PrintJob` creation remains limited to the existing retail custom-order workflow.

## Security and policy boundaries

- Product and variant authority remains server-side.
- Instructions are Zod-trimmed and capped; React renders them as text, not HTML.
- Artwork uses the existing MIME, 5MB, image-service, ownership, and provider abstraction.
- No customer can read or mutate another customer's design/request through customer routes.
- Existing custom cancellation and return rules remain unchanged for paid orders.
- Request submission is not a purchase and emits no purchase analytics event.
- Analytics events contain product identifiers and an artwork-present boolean only; instructions and artwork are excluded.
- Email delivery is not claimed. The current operational boundary is the admin custom-order queue.
