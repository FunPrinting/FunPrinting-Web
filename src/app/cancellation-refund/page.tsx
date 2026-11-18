import Link from 'next/link';
import { Callout, ContactBlock, LegalPage, LegalSection } from '@/components/legal/LegalPage';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const SECTIONS = [
  { id: 'before', title: 'Before you pay' },
  { id: 'automatic', title: 'Automatic refunds after you pay' },
  { id: 'after', title: 'Once the shop has started' },
  { id: 'quality', title: 'Problems with your prints' },
  { id: 'how', title: 'How refunds are paid' },
  { id: 'contact', title: 'Asking for a refund' },
];

export default function CancellationRefundPage() {
  return (
    <LegalPage title="Cancellation and refund policy" intro="When you can cancel, when you are refunded automatically, and how long a refund takes." sections={SECTIONS}>
      <LegalSection id="before" n={1} title="Before you pay">
        <p>You can cancel an order that is not paid yet from <Link href="/my-orders">My orders</Link>. Nothing is charged. A payment link stays open for 30 minutes, and orders left unpaid for 24 hours are cancelled automatically.</p>
      </LegalSection>

      <LegalSection id="automatic" n={2} title="Automatic refunds after you pay">
        <p>You do not need to ask for a refund in these cases. We start it for you, and it covers everything you paid, including the processing fee and delivery charge.</p>
        <Table>
          <TableHeader>
            <TableRow><TableHead>What happens</TableHead><TableHead>What you get</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow><TableCell>The shop declines your order</TableCell><TableCell>Refund starts immediately</TableCell></TableRow>
            <TableRow><TableCell>The shop has not accepted after 10 minutes</TableCell><TableCell>We email you. Choose “Refund now” or “Keep waiting”</TableCell></TableRow>
            <TableRow><TableCell>The shop has not accepted 24 hours after payment</TableCell><TableCell>Refund starts automatically</TableCell></TableRow>
          </TableBody>
        </Table>
        <Callout>We do not move your order to another shop. You choose whether to wait or to be refunded.</Callout>
      </LegalSection>

      <LegalSection id="after" n={3} title="Once the shop has started">
        <p>After the shop has accepted your order and started printing, it can no longer be cancelled, because the paper and ink are already used. Contact us if something is wrong, and we will look at it case by case.</p>
        <p><strong>Usually not refunded:</strong> a change of mind after printing starts, a wrong file or wrong options chosen by you, or an order that was not collected or could not be delivered because of wrong details or no answer.</p>
        <p><strong>Usually refunded:</strong> a shop or technical error on our side, a service that could not be provided, and payment errors such as being charged twice for one order.</p>
      </LegalSection>

      <LegalSection id="quality" n={4} title="Problems with your prints">
        <p>If your prints are damaged, unclear or not what you ordered, contact us within 24 hours of receiving them, with photos. We will arrange a reprint at no extra cost, or a full refund if a reprint is not possible. See also the <Link href="/return-policy">return policy</Link>.</p>
      </LegalSection>

      <LegalSection id="how" n={5} title="How refunds are paid">
        <p>Refunds go back to the payment method you used (card, UPI, net banking or wallet) through Razorpay. After we start a refund, banks usually take 5 to 7 working days to show it. You can follow the status of an order in <Link href="/my-orders">My orders</Link>.</p>
      </LegalSection>

      <LegalSection id="contact" n={6} title="Asking for a refund">
        <p>Send us your order number, the name and phone number on the order, and what went wrong. We reply as soon as we can. If you disagree with our decision, reply to our message and ask for it to be looked at again.</p>
        <ContactBlock hours />
      </LegalSection>
    </LegalPage>
  );
}
