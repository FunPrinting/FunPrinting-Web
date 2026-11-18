import Link from 'next/link';
import { ContactBlock, LegalPage, LegalSection } from '@/components/legal/LegalPage';

const SECTIONS = [
  { id: 'eligible', title: 'When you can ask for a return' },
  { id: 'how', title: 'How to ask' },
  { id: 'not', title: 'What cannot be returned' },
  { id: 'contact', title: 'Contact' },
];

export default function ReturnPolicyPage() {
  return (
    <LegalPage title="Return policy" intro="Prints are made to order, so they cannot be resold. Returns are limited to problems with the print itself." sections={SECTIONS}>
      <LegalSection id="eligible" n={1} title="When you can ask for a return">
        <ul>
          <li>the print quality is poor, or pages are missing, smudged or damaged;</li>
          <li>the print does not match the options you ordered (size, colour, sides, copies, binding);</li>
          <li>the order was damaged on the way to you.</li>
        </ul>
      </LegalSection>

      <LegalSection id="how" n={2} title="How to ask">
        <ol>
          <li>Contact us within <strong>24 hours</strong> of receiving your order.</li>
          <li>Send your order number and clear photos of the problem.</li>
          <li>We check it with the shop that printed it.</li>
          <li>If it is our shop’s fault, we arrange a reprint at no extra cost, or a refund if a reprint is not possible. Refund timing is in the <Link href="/cancellation-refund">cancellation and refund policy</Link>.</li>
        </ol>
      </LegalSection>

      <LegalSection id="not" n={3} title="What cannot be returned">
        <ul>
          <li>orders printed as you specified, even if you no longer want them;</li>
          <li>problems caused by the file you uploaded, such as low-resolution images or a wrong page order;</li>
          <li>documents created from templates;</li>
          <li>orders not collected, or deliveries that failed because the details were wrong or nobody answered.</li>
        </ul>
      </LegalSection>

      <LegalSection id="contact" n={4} title="Contact">
        <ContactBlock hours />
      </LegalSection>
    </LegalPage>
  );
}
