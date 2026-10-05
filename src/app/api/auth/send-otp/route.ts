import { NextRequest, NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { otpStore } from '@/lib/otp-store';

// Configure email transporter using existing environment variables
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_HOST_USER ,
    pass: process.env.EMAIL_HOST_PASSWORD || 'hagbaiwzqltgfflz',
  },
  tls: {
    rejectUnauthorized: false
  }
});

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();
    
    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required' },
        { status: 400 }
      );
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with timestamp (expires in 10 minutes)
    otpStore.set(email, otp);
    console.log(`🔐 OTP stored for ${email}: ${otp}`);
    console.log(`📊 Current OTP store size: ${otpStore.getStoreSize()}`);

    // Email content
    const mailOptions = {
      from: process.env.EMAIL_USER || 'your-email@gmail.com',
      to: email,
      subject: 'Print Service - Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; text-align: center;">Print Service Verification</h2>
          <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #007bff; margin: 0;">Your Verification Code</h3>
            <div style="background: #fff; padding: 15px; border-radius: 5px; margin: 15px 0; text-align: center;">
              <span style="font-size: 32px; font-weight: bold; color: #333; letter-spacing: 5px;">${otp}</span>
            </div>
            <p style="color: #666; margin: 0; font-size: 14px;">
              This code will expire in 10 minutes. Please enter it on the order page to verify your email.
            </p>
          </div>
          <div style="text-align: center; color: #666; font-size: 12px;">
            <p>If you didn't request this code, please ignore this email.</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      `,
    };

    // Send email
    await transporter.sendMail(mailOptions);

    return NextResponse.json({
      success: true,
      message: 'OTP sent successfully',
    });

  } catch (error) {
    console.error('Error sending OTP:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to send OTP' },
      { status: 500 }
    );
  }
}

// Cleanup is handled by the shared OTP store
