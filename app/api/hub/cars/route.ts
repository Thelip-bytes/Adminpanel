import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';


export async function GET(request) {
  try {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Try to use service role for admin operations, fallback to anon
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch vehicles and join with hosts table
    let query = supabase
      .from('vehicles')
      .select(`
        id,
        make,
        model,
        model_year,
        registration_number,
        available_status,
        verification_status,
        base_daily_rate,
        location_name,
        host_id,
        hosts (
          id,
          full_name,
          phone
        ),
        vehicle_images (
          id,
          image_url,
          is_primary
        )
      `);

    // If host is logged in, filter vehicles to only show their own
    if (user.role === 'host') {
      query = query.eq('host_id', user.sub);
    } else {
      // For Admin/Operator fleet view, only return verified/approved vehicles (or legacy nulls)
      query = query.or('verification_status.eq.approved,verification_status.is.null');
    }

    const { data: vehicles, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching cars:', error);
      return NextResponse.json({ error: 'Failed to fetch cars' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: vehicles
    });

  } catch (error) {
    console.error('Unexpected error in cars API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { vehicleId, available_status } = await request.json();

    if (!vehicleId) {
      return NextResponse.json({ error: 'Vehicle ID is required' }, { status: 400 });
    }

    // Role verification
    if (user.role === 'host') {
      return NextResponse.json({ error: 'Only admins can change car availability' }, { status: 403 });
    } else if (user.admin_role === 'operator') {
      return NextResponse.json({ error: 'Operators cannot modify car status' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('vehicles')
      .update({ available_status })
      .eq('id', vehicleId)
      .select();

    if (error) {
      console.error('Error updating car status:', error);
      return NextResponse.json({ error: 'Failed to update car status' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data[0]
    });

  } catch (error) {
    console.error('Unexpected error in cars PATCH API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
