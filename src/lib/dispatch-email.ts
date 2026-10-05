import nodemailer from 'nodemailer';

// Configure email transporter using existing environment variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_HOST_USER ,
    pass: process.env.EMAIL_HOST_PASSWORD || 'hagbaiwzqltgfflz',
  },
  tls: {
    rejectUnauthorized: false
  }
});

/**
 * Send OTP email for order dispatch/delivery verification
 */
export async function sendDispatchOtpEmail(
  email: string,
  customerName: string,
  orderId: string,
  otp: string
): Promise<boolean> {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@funprinting.store',
      to: email,
      subject: `Order Verification OTP - ${orderId}`,
      html: `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 0;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 700;">🖨️ FunPrinting</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">Order Verification</p>
          </div>
          
          <div style="background: #ffffff; padding: 40px 30px; border: 1px solid #e5e7eb; border-top: none;">
            <h2 style="color: #1f2937; margin: 0 0 16px 0; font-size: 20px;">Hi ${customerName}!</h2>
            <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
              Someone is trying to verify and collect order <strong>${orderId}</strong>. 
              Use the OTP below to confirm this action.
            </p>
            
            <div style="background: #f3f4f6; border: 2px dashed #9ca3af; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0; text-transform: uppercase; letter-spacing: 1px;">Your Verification Code</p>
              <div style="font-size: 36px; font-weight: 800; color: #1f2937; letter-spacing: 8px; font-family: 'Courier New', monospace;">
                ${otp}
              </div>
              <p style="color: #9ca3af; font-size: 12px; margin: 8px 0 0 0;">Valid for 10 minutes</p>
            </div>
            
            <div style="background: #fef3c7; border: 1px solid #f59e0b; padding: 16px; border-radius: 8px; margin: 24px 0;">
              <p style="color: #92400e; margin: 0; font-size: 13px;">
                <strong>⚠️ Security Notice:</strong> Never share this OTP with anyone. 
                FunPrinting staff will never ask for your OTP.
              </p>
            </div>
          </div>
          
          <div style="background: #f9fafb; padding: 20px 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
            <p style="color: #9ca3af; font-size: 12px; margin: 0;">
              If you didn't request this, please ignore this email.<br/>
              © ${new Date().getFullYear()} FunPrinting. All rights reserved.
            </p>
          </div>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Dispatch OTP email sent to ${email} for order ${orderId}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending dispatch OTP email:', error);
    return false;
  }
}
