import Link from 'next/link';
import { Callout, ContactBlock, LegalPage, LegalSection } from '@/components/legal/LegalPage';

const SECTIONS = [
  { id: 'service', title: 'What Fun Printing is' },
  { id: 'using', title: 'Using the site' },
  { id: 'prices', title: 'Prices and payment' },
  { id: 'orders', title: 'Orders and print shops' },
  { id: 'delivery', title: 'Pickup and delivery' },
  { id: 'refunds', title: 'Cancellations, refunds and returns' },
  { id: 'templates', title: 'Templates' },
  { id: 'content', title: 'Your files' },
  { id: 'liability', title: 'Liability' },
  { id: 'changes', title: 'Changes and disputes' },
  { id: 'contact', title: 'Contact' },
];

export default function TermsPage() {
  return (
    <LegalPage title="Terms and conditions" intro="Please read these terms before you order. By using Fun Printing you agree to them." sections={SECTIONS}>
      <LegalSection id="service" n={1} title="What Fun Printing is">
        <p>Fun Printing is an online marketplace. You upload documents, choose a print shop near you, and pay online. The shop prints your order, and you collect it or have it delivered.</p>
        <p>The print shops are independent businesses. We run the website, take your payment, pass your order to the shop you chose, and help if something goes wrong. We do not print orders ourselves.</p>
      </LegalSection>

      <LegalSection id="using" n={2} title="Using the site">
        <p>You agree to:</p>
        <ul>
          <li>give correct details, including a phone number you can answer, because the shop and our team use it to contact you about your order;</li>
          <li>upload only files you have the right to print, and nothing illegal or harmful;</li>
          <li>keep your sign-in details private. You are responsible for what happens under your account;</li>
          <li>collect or be available for your order as described in the <Link href="/shipping-delivery">shipping and delivery policy</Link>.</li>
        </ul>
        <p>We may refuse or cancel an order, with a refund, if it breaks these terms or the law.</p>
      </LegalSection>

      <LegalSection id="prices" n={3} title="Prices and payment">
        <ul>
          <li>Each shop sets its own prices. The price for your documents at each shop is shown before you choose.</li>
          <li>The price comes from the shop’s rates and your options (paper size, colour, sides, copies, binding). After you upload, we count the pages ourselves. If our count differs from yours, the new price is shown and you decide whether to pay.</li>
          <li>A processing fee of 3% is added and shown as its own line. Any delivery charge is shown too.</li>
          <li>You pay online through Razorpay (UPI, cards, net banking and wallets). We never see your card details.</li>
          <li>A payment link stays open for 30 minutes. Orders left unpaid for 24 hours are cancelled automatically. Nothing is charged for an unpaid order.</li>
        </ul>
      </LegalSection>

      <LegalSection id="orders" n={4} title="Orders and print shops">
        <p>After you pay, your order goes to the shop you chose. Some shops accept orders automatically; others accept each one by hand.</p>
        <ul>
          <li>If the shop declines your order, you are refunded straight away.</li>
          <li>If the shop has not accepted after 10 minutes, we tell you and you can either get a refund now or keep waiting.</li>
          <li>If the shop has not accepted 24 hours after you paid, you are refunded automatically.</li>
        </ul>
        <p>We do not move your order to a different shop. Time to print depends on the shop and how busy it is.</p>
      </LegalSection>

      <LegalSection id="delivery" n={5} title="Pickup and delivery">
        <p>You can collect from the shop (free), or, where the shop offers it, have the order delivered by the shop or by courier. The options and charges are shown at checkout. Details are in the <Link href="/shipping-delivery">shipping and delivery policy</Link>.</p>
      </LegalSection>

      <LegalSection id="refunds" n={6} title="Cancellations, refunds and returns">
        <p>These are covered in the <Link href="/cancellation-refund">cancellation and refund policy</Link> and the <Link href="/return-policy">return policy</Link>, which form part of these terms.</p>
      </LegalSection>

      <LegalSection id="templates" n={7} title="Templates">
        <p>Templates help you create documents such as resumes, covers and reports. Some are free and some are paid; the price is shown before you pay. A document is created from what you enter, so check it before you print. Template documents are personal to you and are not returnable once created.</p>
      </LegalSection>

      <LegalSection id="content" n={8} title="Your files">
        <p>Your files stay yours. By uploading, you let us store them and send them to the shop that prints your order, and nothing more. You are responsible for having the right to print them.</p>
        <p>How we handle your information is described in the <Link href="/privacy">privacy policy</Link>.</p>
      </LegalSection>

      <LegalSection id="liability" n={9} title="Liability">
        <p>We work to keep the service reliable but cannot promise it will always be available or error-free. To the extent the law allows, we are not liable for indirect, incidental or consequential loss. Nothing here limits rights you have under Indian consumer law.</p>
      </LegalSection>

      <LegalSection id="changes" n={10} title="Changes and disputes">
        <p>We may update these terms. The date at the top shows the latest version. Orders you have already paid for stay under the terms that applied when you paid.</p>
        <p>If you have a problem, contact us first and we will try to sort it out. These terms are governed by the laws of India.</p>
        <Callout>Questions about an order? Have the order number ready; it speeds everything up.</Callout>
      </LegalSection>

      <LegalSection id="contact" n={11} title="Contact">
        <ContactBlock hours />
      </LegalSection>
    </LegalPage>
  );
}
