import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { sendWhatsAppOTP } from '@/app/api/auth/utils/whatsapp';
import { normalizeIndianPhone } from '@/lib/phone';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const hashOTP = (otp: string) => crypto.createHash('sha256').update(otp).digest('hex');

export async function POST(request: Request) {
  try {
    const { phone, role } = await request.json();
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) return NextResponse.json({ error: 'Enter a valid 10-digit phone number' }, { status: 400 });

    const [adminResult, hostResult] = await Promise.all([
      supabase.from('admin_users').select('id').in('phone', normalized.candidates).eq('is_active', true).limit(1),
      supabase.from('hosts').select('id').in('phone', normalized.candidates).eq('verified', true).limit(1),
    ]);

    if (adminResult.error || hostResult.error) {
      console.error('Login lookup failed:', adminResult.error || hostResult.error);
      return NextResponse.json({ error: 'Unable to check this phone number. Please try again.' }, { status: 500 });
    }

    const roles = [adminResult.data?.length ? 'admin' : null, hostResult.data?.length ? 'host' : null].filter(Boolean) as string[];
    if (roles.length === 0) return NextResponse.json({ error: 'This phone number is not registered for portal access' }, { status: 403 });

    let targetRole = role;
    if (!targetRole) {
      if (roles.length > 1) {
        return NextResponse.json({ requiresRoleChoice: true, roles });
      }
      targetRole = roles[0];
    }

    if (targetRole !== 'admin' && targetRole !== 'host') return NextResponse.json({ error: 'Select the portal you want to access' }, { status: 400 });
    if (!roles.includes(targetRole)) return NextResponse.json({ error: 'This phone number does not have access to that portal' }, { status: 403 });

    const { data: lastOtp } = await supabase.from('otp_events').select('created_at').eq('phone', normalized.e164).order('created_at', { ascending: false }).limit(1);
    if (lastOtp?.length) {
      const remaining = 60000 - (Date.now() - new Date(lastOtp[0].created_at).getTime());
      if (remaining > 0) return NextResponse.json({ error: `Please wait ${Math.ceil(remaining / 1000)} seconds before requesting another code.` }, { status: 429 });
    }

    const length = Number(process.env.OTP_LENGTH || 4);
    const otp = crypto.randomInt(10 ** (length - 1), 10 ** length).toString();
    const { error: otpError } = await supabase.from('otp_events').insert({
      phone: normalized.e164,
      otp_hash: hashOTP(otp),
      expires_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    });
    if (otpError) throw otpError;

    if (!await sendWhatsAppOTP(normalized.e164, otp)) {
      return NextResponse.json({ error: 'Message provider error' }, { status: 500 });
    }

    return NextResponse.json({ success: true, role: targetRole });
  } catch (error) {
    console.error('Unified OTP request error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
