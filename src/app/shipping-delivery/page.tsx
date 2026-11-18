import Link from 'next/link';
import { Callout, ContactBlock, LegalPage, LegalSection } from '@/components/legal/LegalPage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SECTIONS = [
  { id: 'options', title: 'Ways to get your order' },
  { id: 'time', title: 'How long it takes' },
  { id: 'code', title: 'The delivery code' },
  { id: 'tracking', title: 'Tracking your order' },
  { id: 'failed', title: 'If a delivery fails' },
  { id: 'delays', title: 'Delays' },
  { id: 'contact', title: 'Contact' },
];

export default function ShippingDeliveryPage() {
  return (
    <LegalPage title="Shipping and delivery policy" intro="Every order is printed by the shop you choose. Which delivery options you see depends on that shop." sections={SECTIONS}>
      <LegalSection id="options" n={1} title="Ways to get your order">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Option</TableHead><TableHead>Who brings it</TableHead><TableHead>Charge</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Pickup</TableCell>
              <TableCell>You collect from the shop, or from a pickup point the shop lists</TableCell>
              <TableCell>Free</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Delivered by the shop</TableCell>
              <TableCell>The shop’s own delivery person, for addresses within the distance the shop sets</TableCell>
              <TableCell>The shop’s fee, shown at checkout</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Courier</TableCell>
              <TableCell>A courier collects from the shop and delivers to your pincode</TableCell>
              <TableCell>The courier’s rate for your pincode, shown at checkout</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <p>Not every shop delivers. The shop list tells you whether a shop is “Pickup only”, delivers within some distance, or offers courier delivery. You always see the delivery charge and the total before you pay.</p>
      </LegalSection>

      <LegalSection id="time" n={2} title="How long it takes">
        <ul>
          <li><strong>Printing:</strong> the shop prints your order after it accepts it. How long that takes depends on the shop and its queue.</li>
          <li><strong>Delivered by the shop:</strong> the shop shows its usual delivery time at checkout. It counts from when printing is finished.</li>
          <li><strong>Courier:</strong> the delivery time is shown at checkout for each speed. It counts from when the courier collects the parcel.</li>
        </ul>
        <p>These are estimates, not guarantees.</p>
      </LegalSection>

      <LegalSection id="code" n={3} title="The delivery code">
        <p>When the shop delivers your order itself, you get a 4-digit code in <Link href="/my-orders">My orders</Link>, on the order page and in your confirmation email. Give it to the delivery person when you receive your order. The shop enters it to mark the order delivered.</p>
        <Callout>Do not share the code before you have your order in your hands.</Callout>
      </LegalSection>

      <LegalSection id="tracking" n={4} title="Tracking your order">
        <p>The order page in <Link href="/my-orders">My orders</Link> shows each step: paid, accepted by the shop, printed, ready or on the way, and delivered. For courier deliveries it also shows the courier and a tracking link.</p>
      </LegalSection>

      <LegalSection id="failed" n={5} title="If a delivery fails">
        <ul>
          <li>Give a complete address and a phone number you answer. The delivery person or courier will call you.</li>
          <li>If nobody can be reached or the address is wrong, the delivery may fail. Couriers follow their own rules for repeat attempts and returns.</li>
          <li>Delivery charges are not refunded when a delivery fails because of wrong details or no answer. Contact us and we will help sort out the next step.</li>
        </ul>
      </LegalSection>

      <LegalSection id="delays" n={6} title="Delays">
        <p>Holidays, bad weather, heavy demand, or a shop being closed can slow things down. If your order is delayed, the order page shows where it is. If the shop does not accept your order, the <Link href="/cancellation-refund">refund rules</Link> apply.</p>
      </LegalSection>

      <LegalSection id="contact" n={7} title="Contact">
        <p>Questions about a delivery? Have your order number ready.</p>
        <ContactBlock hours />
      </LegalSection>
    </LegalPage>
  );
}
