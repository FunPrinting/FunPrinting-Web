import Link from 'next/link';
import { ContactBlock, LegalPage, LegalSection } from '@/components/legal/LegalPage';

const SECTIONS = [
  { id: 'collect', title: 'What we collect' },
  { id: 'use', title: 'How we use it' },
  { id: 'share', title: 'Who else sees it' },
  { id: 'ads', title: 'Advertising and cookies' },
  { id: 'keep', title: 'How long we keep it' },
  { id: 'security', title: 'Security' },
  { id: 'rights', title: 'Your choices' },
  { id: 'contact', title: 'Contact' },
];

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" intro="This explains what Fun Printing collects when you use the site, why, and who it is shared with." sections={SECTIONS}>
      <LegalSection id="collect" n={1} title="What we collect">
        <ul>
          <li><strong>Account:</strong> your name, email address and phone number. If you sign in with Google, we receive your name and email from Google. Passwords are stored in scrambled (hashed) form, never as plain text.</li>
          <li><strong>Orders:</strong> the files you upload, your print options, and for delivery the recipient’s name, phone number and address.</li>
          <li><strong>Payments:</strong> Razorpay handles your payment details. We keep the payment reference, amount and status, not your card or UPI details.</li>
          <li><strong>Technical records:</strong> logs and error reports that help us keep the service working and secure.</li>
        </ul>
      </LegalSection>

      <LegalSection id="use" n={2} title="How we use it">
        <ul>
          <li>to take, print, deliver, refund and support your orders;</li>
          <li>to contact you about an order by email or phone;</li>
          <li>to prevent fraud and misuse, and to fix problems;</li>
          <li>to meet legal and accounting duties.</li>
        </ul>
        <p>We do not sell your information.</p>
      </LegalSection>

      <LegalSection id="share" n={3} title="Who else sees it">
        <p>We share information only as needed to deliver your order:</p>
        <ul>
          <li><strong>The print shop you choose</strong> sees your files, print options, name and phone number, and your address if the shop delivers.</li>
          <li><strong>Couriers</strong> (through Shiprocket and its courier partners) receive the recipient’s name, phone number and address for courier deliveries.</li>
          <li><strong>Razorpay</strong> processes payments and refunds.</li>
          <li><strong>Cloudinary</strong> and our other storage providers store uploaded files.</li>
          <li><strong>Google</strong> provides sign-in and advertising (see below).</li>
          <li><strong>Email services</strong> send you order emails and invoices.</li>
          <li><strong>Authorities</strong>, where the law requires it.</li>
        </ul>
      </LegalSection>

      <LegalSection id="ads" n={4} title="Advertising and cookies">
        <p>We use a cookie to keep you signed in. The site also shows ads from Google AdSense. Google and its partners may use cookies to show ads and measure them. You can manage this in <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">Google’s ad settings</a>.</p>
      </LegalSection>

      <LegalSection id="keep" n={5} title="How long we keep it">
        <p>We keep your account while you use it, and order and payment records for as long as we need them to handle disputes, refunds and tax or accounting rules.</p>
      </LegalSection>

      <LegalSection id="security" n={6} title="Security">
        <p>Traffic to the site is encrypted, passwords are hashed, and payment details go to Razorpay, not through our servers. We share your files only with the shop that prints your order and with our support team. No online service is perfectly secure, so use a strong, unique password.</p>
      </LegalSection>

      <LegalSection id="rights" n={7} title="Your choices">
        <p>You can see and change your name and phone number on your <Link href="/profile">profile</Link>. You can also ask us to:</p>
        <ul>
          <li>give you a copy of the information we hold about you;</li>
          <li>correct anything that is wrong;</li>
          <li>delete your account and personal data. We may keep records we are legally required to keep, such as payment records.</li>
        </ul>
      </LegalSection>

      <LegalSection id="contact" n={8} title="Contact">
        <p>For any privacy question or request:</p>
        <ContactBlock />
      </LegalSection>
    </LegalPage>
  );
}
