import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import connectDB from './mongodb';
import User from '@/models/User';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile',
        },
      },
    }),
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        try {
          await connectDB();
          
          // Find user by email (can be email or google provider)
          const user = await User.findOne({ 
            email: credentials.email.toLowerCase()
          });

          if (!user || !user.password) {
            return null;
          }

          // Allow login if user has password, regardless of provider
          // This allows Google OAuth users who set up a password to login with email/password

          const isPasswordValid = await bcrypt.compare(credentials.password, user.password);
          
          if (!isPasswordValid) {
            return null;
          }

          // Check if email is verified
          if (!user.emailVerified) {
            throw new Error('EMAIL_NOT_VERIFIED');
          }

          // Update last login
          await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

          return {
            id: user._id,
            email: user.email,
            name: user.name,
            image: user.profilePicture,
            role: user.role,
          };
        } catch (error) {
          // Re-throw EMAIL_NOT_VERIFIED so NextAuth can pass it to the frontend
          if (error instanceof Error && error.message === 'EMAIL_NOT_VERIFIED') {
            throw error;
          }
          console.error('Auth error:', error);
          return null;
        }
      }
    })
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        try {
          await connectDB();
          
          // Note: Phone number access requires Google app verification
          // For now, we'll skip phone number fetching to avoid OAuth issues
          const phoneNumber = null;
          
          // Check if user exists
          const existingUser = await User.findOne({ 
            $or: [
              { email: user.email },
              { providerId: account.providerAccountId }
            ]
          });

          if (existingUser) {
            // Update last login and profile picture
            const updateData: any = { 
              lastLogin: new Date(),
              profilePicture: user.image 
            };
            
            if (phoneNumber && !existingUser.phone) {
              updateData.phone = phoneNumber;
            }
            
            await User.findByIdAndUpdate(existingUser._id, updateData);
            console.log(`✅ User login successful for: ${user.email}`);
            return true;
          }

          // Create new user (regular user by default)
          const newUser = await User.create({
            name: user.name || '',
            email: user.email || '',
            phone: phoneNumber || '',
            provider: 'google',
            providerId: account.providerAccountId,
            emailVerified: true,
            profilePicture: user.image,
            lastLogin: new Date(),
            role: 'customer', // Regular customer by default
          });

          console.log(`✅ New user created: ${user.email}`);
          return true;
        } catch (error) {
          console.error('Google sign-in error:', error);
          return false;
        }
      }
      
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        // If user object is present, this is the first time the token is created
        try {
          await connectDB();
          const dbUser = await User.findOne({ email: user.email });
          if (dbUser) {
            token.id = dbUser._id.toString();
            token.image = dbUser.profilePicture || user.image;
            token.role = dbUser.role;
          } else {
            token.id = user.id;
            token.image = user.image;
            token.role = (user as any).role || 'customer';
          }
        } catch (e) {
          console.error('Error fetching user for JWT:', e);
          token.id = user.id;
          token.image = user.image;
          token.role = (user as any).role || 'customer';
        }
      }
      
      // Refresh profile picture from database on each JWT update
      if (token.id) {
        try {
          await connectDB();
          let dbUser;
          // Check if token.id is a valid ObjectId (24 hex characters)
          const isValidHex = /^[0-9a-fA-F]{24}$/.test(token.id as string);
          if (token.id && isValidHex) {
            dbUser = await User.findById(token.id);
          } else if (token.email) {
            dbUser = await User.findOne({ email: token.email });
            if (dbUser) token.id = dbUser._id.toString(); // Self-heal
          }
          
          if (dbUser && dbUser.profilePicture) {
            token.image = dbUser.profilePicture;
          }
          if (dbUser && dbUser.role) {
            token.role = dbUser.role;
          }
        } catch (error) {
          console.error('Error fetching user profile picture in JWT:', error);
        }
      }
      
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role as string;
        // Include profile picture from token
        if (token.image) {
          session.user.image = token.image as string;
        } else {
          // Only fetch from database if not in token
          try {
            await connectDB();
            let user;
            const isValidHex = /^[0-9a-fA-F]{24}$/.test(token.id as string);
            if (token.id && isValidHex) {
              user = await User.findById(token.id);
            } else if (session.user.email) {
              user = await User.findOne({ email: session.user.email });
              if (user) (session.user as any).id = user._id.toString(); // Self-heal
            }
            if (user && user.profilePicture) {
              session.user.image = user.profilePicture;
            }
          } catch (error) {
            console.error('Error fetching user profile picture:', error);
          }
        }
      }
      return session;
    }
  },
  pages: {
    signIn: '/auth/signin',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
