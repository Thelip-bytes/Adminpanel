import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Role verification: only admins can verify/approve vehicles
    if (user.role === 'host' || user.admin_role === 'operator') {
      return NextResponse.json({ error: 'Forbidden: Admin privileges required to verify vehicles' }, { status: 403 });
    }

    const body = await request.json();
    const { vehicleId, action, base_daily_rate, make_available, rejection_notes } = body;

    if (!vehicleId) {
      return NextResponse.json({ error: 'Vehicle ID is required' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'reject') {
      return NextResponse.json({ error: 'Action must be either "approve" or "reject"' }, { status: 400 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Database configuration missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify vehicle exists
    const { data: vehicle, error: fetchErr } = await supabase
      .from('vehicles')
      .select('id, make, model, registration_number, host_id, verification_status')
      .eq('id', vehicleId)
      .single();

    if (fetchErr || !vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    let updateData: Record<string, any> = {
      reviewed_at: new Date().toISOString(),
    };

    if (action === 'approve') {
      const parsedRate = Number(base_daily_rate);
      if (!parsedRate || isNaN(parsedRate) || parsedRate <= 0) {
        return NextResponse.json({ error: 'A valid base daily rental rate (greater than 0) is required for approval' }, { status: 400 });
      }

      updateData.verification_status = 'approved';
      updateData.base_daily_rate = parsedRate;
      updateData.available_status = make_available !== false;
      updateData.rejection_notes = null;
    } else {
      // Rejection
      if (!rejection_notes || !rejection_notes.trim()) {
        return NextResponse.json({ error: 'Please provide feedback/rejection reason for the host' }, { status: 400 });
      }

      updateData.verification_status = 'rejected';
      updateData.rejection_notes = rejection_notes.trim();
      updateData.available_status = false;
    }

    const { data: updatedVehicle, error: updateErr } = await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId)
      .select(`
        id,
        vehicle_code,
        make,
        model,
        registration_number,
        available_status,
        verification_status,
        base_daily_rate,
        rejection_notes,
        reviewed_at
      `)
      .single();

    if (updateErr) {
      console.error('Error updating vehicle verification status:', updateErr);
      return NextResponse.json({ error: 'Failed to update vehicle verification status' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: action === 'approve' 
        ? `Vehicle ${vehicle.make} ${vehicle.model} approved and ${updateData.available_status ? 'promoted to live' : 'saved as blocked'}`
        : `Vehicle ${vehicle.make} ${vehicle.model} rejected`,
      data: updatedVehicle
    });

  } catch (error: any) {
    console.error('Unexpected error in car verify API:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
