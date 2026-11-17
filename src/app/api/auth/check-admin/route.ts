import { NextResponse } from 'next/server';
import { getSessionUser, isAdminSession } from '@/lib/authz';

/**
 * Returns whether the *current session* is an admin.
 * Any email in the request body/query is ignored.
 */
async function handle() {
  try {
    const user = await getSessionUser();
    return NextResponse.json(
      { isAdmin: isAdminSession(user) },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Error checking admin role:', error);
    return NextResponse.json({ isAdmin: false }, { status: 500 });
  }
}

export async function GET() {
  return handle();
}

// POST kept for backward compatibility with older clients; body is ignored.
export async function POST() {
  return handle();
}
