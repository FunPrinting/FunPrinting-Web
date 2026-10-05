import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import connectDB from './mongodb';
import DynamicTemplate from '@/models/DynamicTemplate';
import User from '@/models/User';

/**
 * Check if a user owns a template
 */
export async function checkTemplateOwnership(templateId: string, userId: string): Promise<boolean> {
  try {
    await connectDB();
    const template = await DynamicTemplate.findOne({ id: templateId });
    
    if (!template) {
      return false;
    }

    // Get user to check email
    const user = await User.findById(userId);
    if (!user) {
      return false;
    }

    // Check if createdByUserId matches
    if (template.createdByUserId && template.createdByUserId.toString() === userId) {
      return true;
    }

    // Fallback: check by email
    if (template.createdByEmail && template.createdByEmail.toLowerCase() === user.email.toLowerCase()) {
      return true;
    }

    return false;
  } catch (error) {
    console.error('Error checking template ownership:', error);
    return false;
  }
}

/**
 * Check if a user can edit a template
 */
export async function canEditTemplate(templateId: string, userId: string | null, isAdmin: boolean = false): Promise<boolean> {
  if (!userId) {
    return false;
  }

  // Admins can edit any template
  if (isAdmin) {
    return true;
  }

  // Users can only edit their own templates
  return await checkTemplateOwnership(templateId, userId);
}

/**
 * Check if a user can delete a template
 */
export async function canDeleteTemplate(templateId: string, userId: string | null, isAdmin: boolean = false): Promise<boolean> {
  if (!userId) {
    return false;
  }

  // Admins can delete any template
  if (isAdmin) {
    return true;
  }

  // Users can only delete their own templates
  return await checkTemplateOwnership(templateId, userId);
}

/**
 * Check if a user can view a template
 */
export async function canViewTemplate(templateId: string, userId: string | null): Promise<boolean> {
  try {
    await connectDB();
    const template = await DynamicTemplate.findOne({ id: templateId });
    
    if (!template) {
      return false;
    }

    // Public templates can be viewed by anyone
    if (template.isPublic) {
      return true;
    }

    // If not public, only the owner can view
    if (!userId) {
      return false;
    }

    return await checkTemplateOwnership(templateId, userId);
  } catch (error) {
    console.error('Error checking template view permission:', error);
    return false;
  }
}

/**
 * Get current user session
 */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user || null;
}

/**
 * Check if current user is admin
 */
export async function isAdminUser(): Promise<boolean> {
  try {
    const user = await getCurrentUser();
    if (!user?.email) {
      return false;
    }

    await connectDB();
    const userDoc = await User.findOne({ email: user.email.toLowerCase() });
    
    if (!userDoc) {
      return false;
    }

    // Check if user has admin role OR is the specific admin email
    return userDoc.role === 'admin' || user.email.toLowerCase() === process.env.NEXT_PUBLIC_ADMIN_EMAIL;
  } catch (error) {
    console.error('Error checking admin status:', error);
    return false;
  }
}

