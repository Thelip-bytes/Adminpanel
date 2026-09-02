import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role === 'host') {
      return NextResponse.json({ error: 'Forbidden: Hosts cannot view approval queues' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch vehicles pending review
    const { data: vehicles, error } = await supabase
      .from('vehicles')
      .select(`
        id,
        vehicle_code,
        make,
        model,
        model_year,
        color,
        registration_number,
        city,
        location_name,
        latitude,
        longitude,
        vehicle_type,
        fuel_type,
        transmission_type,
        seating_capacity,
        mileage_kmpl,
        description,
        base_daily_rate,
        available_status,
        verification_status,
        created_at,
        host_id,
        hosts (
          id,
          full_name,
          phone,
          verified
        ),
        vehicle_images (
          id,
          image_url,
          is_primary
        )
      `)
      .eq('verification_status', 'under_review')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching pending vehicles:', error);
      return NextResponse.json({ error: 'Failed to fetch pending vehicles' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      count: vehicles?.length || 0,
      data: vehicles || []
    });

  } catch (error: any) {
    console.error('Unexpected error in pending cars API:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
