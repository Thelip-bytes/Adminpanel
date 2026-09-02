import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserFromRequest } from '@/lib/auth';
import { sendVehicleAddedTelegramNotification } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

const CITY_COORDINATES: Record<string, { latitude: number; longitude: number }> = {
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  chennai: { latitude: 13.0827, longitude: 80.2707 },
  coimbatore: { latitude: 11.0168, longitude: 76.9558 },
};

function getCityCoordinates(city: string) {
  return CITY_COORDINATES[city.trim().toLowerCase()] || CITY_COORDINATES.bengaluru;
}

function buildAddress(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => (part || '').toString().trim())
    .filter(Boolean)
    .join(', ');
}

async function geocodeAddress(address: string) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey || !address) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('region', 'in');

    const response = await fetch(url.toString());
    if (!response.ok) {
      console.error('Google geocoding request failed:', response.status);
      return null;
    }

    const data = await response.json();
    const location = data.results?.[0]?.geometry?.location;
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      console.error('Google geocoding returned no location for submitted address');
      return null;
    }

    return {
      latitude: location.lat,
      longitude: location.lng,
    };
  } catch (error: any) {
    console.error('Google geocoding error:', error.message);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const user = getUserFromRequest(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isHost = user.role === 'host';
    const isAdmin = user.admin_role === 'admin';
    if (!isHost && !isAdmin) {
      return NextResponse.json({ error: 'Only hosts and admins can add vehicles' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Server configuration error: Supabase credentials missing' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const formData = await request.formData();
    const hostId = isHost ? Number(user.sub) : Number(formData.get('host_id'));
    if (!hostId || isNaN(hostId)) {
      return NextResponse.json({ error: isAdmin ? 'Select a valid host for this vehicle' : 'Invalid host ID in session' }, { status: 400 });
    }

    // Verify the target host exists before creating a vehicle for it.
    const { data: hostRecord, error: hostErr } = await supabase
      .from('hosts')
      .select('id, full_name, phone, verified')
      .eq('id', hostId)
      .single();

    if (hostErr || !hostRecord || !hostRecord.verified) {
      return NextResponse.json({ error: `Registered host not found for ID ${hostId}` }, { status: 404 });
    }

    // 1. Extract Vehicle Specifications from FormData
    const make = (formData.get('make') || formData.get('carBrand') || '').toString().trim();
    const model = (formData.get('model') || formData.get('carName') || '').toString().trim();
    const modelYearStr = (formData.get('model_year') || formData.get('year') || '').toString().trim();
    const model_year = modelYearStr ? parseInt(modelYearStr, 10) : new Date().getFullYear();
    const color = (formData.get('color') || '').toString().trim();
    const vehicle_type = (formData.get('vehicle_type') || formData.get('vehicleType') || 'SUV').toString().trim();
    const fuel_type = (formData.get('fuel_type') || formData.get('fuelType') || 'Petrol').toString().trim();
    const transmission_type = (formData.get('transmission_type') || formData.get('transmission') || 'Manual').toString().trim();
    const seatingCapacityStr = (formData.get('seating_capacity') || formData.get('seats') || '5').toString().trim();
    const seating_capacity = parseInt(seatingCapacityStr, 10) || 5;

    const registration_number = (formData.get('registration_number') || formData.get('registration') || '').toString().trim().toUpperCase();
    const mileageStr = (formData.get('mileage_kmpl') || formData.get('mileage') || '15').toString().trim();
    const mileage_kmpl = parseFloat(mileageStr) || 15;
    const description = (formData.get('description') || '').toString().trim();
    const baseDailyRateRaw = (formData.get('base_daily_rate') || '').toString().trim();
    const base_daily_rate = baseDailyRateRaw ? Number(baseDailyRateRaw) : null;

    const door_no = (formData.get('door_no') || formData.get('doorNo') || '').toString().trim();
    const street = (formData.get('street') || '').toString().trim();
    const area = (formData.get('area') || '').toString().trim();
    const city = (formData.get('city') || 'Bengaluru').toString().trim();
    const district = (formData.get('district') || '').toString().trim();
    const state = (formData.get('state') || '').toString().trim();
    const pincode = (formData.get('pincode') || '').toString().trim();
    const fullAddress = buildAddress([door_no, street, area, city, district, state, pincode]);
    const location_name = (formData.get('location_name') || fullAddress || 'Hub Location').toString().trim();
    const submittedLatitude = parseFloat((formData.get('latitude') || '').toString());
    const submittedLongitude = parseFloat((formData.get('longitude') || '').toString());
    const geocodedCoordinates = Number.isFinite(submittedLatitude) && Number.isFinite(submittedLongitude)
      ? null
      : await geocodeAddress(location_name);
    const fallbackCoordinates = getCityCoordinates(city);
    const latitude = Number.isFinite(submittedLatitude) ? submittedLatitude : geocodedCoordinates?.latitude ?? fallbackCoordinates.latitude;
    const longitude = Number.isFinite(submittedLongitude) ? submittedLongitude : geocodedCoordinates?.longitude ?? fallbackCoordinates.longitude;

    if (!make || !model || !registration_number) {
      return NextResponse.json({ error: 'Make, model, and registration number are required' }, { status: 400 });
    }

    if (!description || description.length < 168) {
      return NextResponse.json({
        error: `Car description must be at least 168 characters (currently ${description.length}/168).`
      }, { status: 400 });
    }

    if (isAdmin && (base_daily_rate === null || !Number.isFinite(base_daily_rate) || base_daily_rate <= 0)) {
      return NextResponse.json({ error: 'Admins must provide a valid base daily price' }, { status: 400 });
    }

    const mainImage = formData.get('main') || formData.get('mainImage');
    if (!(mainImage instanceof File) || mainImage.size === 0) {
      return NextResponse.json({ error: 'A main cover image is required before a vehicle can be submitted' }, { status: 400 });
    }

    if (!mainImage.type.startsWith('image/') || mainImage.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'The main cover image must be an image file no larger than 10 MB' }, { status: 400 });
    }

    const { data: duplicateVehicle, error: duplicateLookupError } = await supabase
      .from('vehicles')
      .select('id')
      .eq('registration_number', registration_number)
      .limit(1)
      .maybeSingle();

    if (duplicateLookupError) {
      console.error('Could not check duplicate registration:', duplicateLookupError);
      return NextResponse.json({ error: 'Unable to validate the registration number. Please try again.' }, { status: 500 });
    }

    if (duplicateVehicle) {
      return NextResponse.json({ error: 'A vehicle with this registration number has already been added' }, { status: 409 });
    }

    // 2. Compute Host Code (e.g. HOST04) and Next Sequence Number
    const hostPrefix = `HOST${String(hostId).padStart(2, '0')}`;

    // Query existing vehicles for this host to extract max sequence number
    const { data: existingVehicles, error: vehQueryErr } = await supabase
      .from('vehicles')
      .select('vehicle_code')
      .eq('host_id', hostId);

    if (vehQueryErr) {
      console.error('Error fetching host vehicles for code calculation:', vehQueryErr);
    }

    let maxSeq = 0;
    if (existingVehicles && existingVehicles.length > 0) {
      existingVehicles.forEach((v) => {
        if (v.vehicle_code && typeof v.vehicle_code === 'string') {
          const match = v.vehicle_code.match(/-(\d+)$/);
          if (match) {
            const seq = parseInt(match[1], 10);
            if (!isNaN(seq) && seq > maxSeq) {
              maxSeq = seq;
            }
          }
        }
      });
    }

    const nextSeq = maxSeq + 1;
    const carSeqStr = String(nextSeq).padStart(3, '0');
    const vehicle_code = `${hostPrefix}-${carSeqStr}`; // e.g. HOST04-007

    // 3. Insert Vehicle Record into DB
    const { data: insertedVehicle, error: insertVehErr } = await supabase
      .from('vehicles')
      .insert([
        {
          host_id: hostId,
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
          base_daily_rate: isAdmin ? base_daily_rate : null,
          available_status: isAdmin ? true : false,
          verification_status: isAdmin ? 'approved' : 'under_review',
        },
      ])
      .select()
      .single();

    if (insertVehErr || !insertedVehicle) {
      console.error('Failed to insert vehicle into database:', insertVehErr);
      return NextResponse.json({ error: `Failed to insert vehicle: ${insertVehErr?.message}` }, { status: 500 });
    }

    const vehicleId = insertedVehicle.id;

    // 4. Upload Image Files to Supabase Storage Bucket ('car-images')
    const imageKeys = ['main', 'front', 'side', 'interior', 'rear'];
    const uploadedImages = [];
    const uploadedFilenames: string[] = [];
    let mainUploadFailed = false;

    const imageFieldsMap: Record<string, string[]> = {
      main: ['main', 'mainImage'],
      front: ['front', 'frontImage'],
      side: ['side', 'sideImage'],
      interior: ['interior', 'inside', 'insideImage'],
      rear: ['rear', 'back', 'backImage'],
    };

    let hasPrimary = false;

    for (const typeKey of imageKeys) {
      let file: File | null = null;
      const possibleFieldNames = imageFieldsMap[typeKey];

      for (const fieldName of possibleFieldNames) {
        const potentialFile = formData.get(fieldName);
        if (potentialFile && potentialFile instanceof File && potentialFile.size > 0) {
          file = potentialFile;
          break;
        }
      }

      if (file) {
        const mimeType = file.type || 'image/png';
        let ext = 'png';
        if (mimeType.includes('jpeg') || mimeType.includes('jpg')) ext = 'jpg';
        else if (mimeType.includes('webp')) ext = 'webp';

        // Format filename: HOST04-007-front.png
        const filename = `${vehicle_code}-${typeKey}.${ext}`;
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Upload directly to root of 'car-images' bucket
        const { error: uploadErr } = await supabase.storage
          .from('car-images')
          .upload(filename, buffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Failed to upload ${filename} to car-images bucket:`, uploadErr);
          if (typeKey === 'main') mainUploadFailed = true;
        } else {
          uploadedFilenames.push(filename);
          const isPrimary = typeKey === 'main' || (!hasPrimary && typeKey === 'front');
          if (isPrimary) hasPrimary = true;

          // Insert row into vehicle_images
          const { data: imgRow, error: imgDbErr } = await supabase
            .from('vehicle_images')
            .insert([
              {
                vehicle_id: vehicleId,
                image_url: filename,
                is_primary: isPrimary,
              },
            ])
            .select()
            .single();

          if (imgDbErr) {
            console.error(`Failed to insert vehicle_image row for ${filename}:`, imgDbErr);
            if (typeKey === 'main') mainUploadFailed = true;
          } else {
            uploadedImages.push(imgRow);
          }
        }
      }

      if (mainUploadFailed) break;
    }

    if (mainUploadFailed) {
      if (uploadedFilenames.length > 0) {
        await supabase.storage.from('car-images').remove(uploadedFilenames);
      }
      await supabase.from('vehicles').delete().eq('id', vehicleId);
      return NextResponse.json({ error: 'We could not save the required cover photo. No vehicle was created; please try again.' }, { status: 500 });
    }

    if (isHost) {
      await sendVehicleAddedTelegramNotification({
        vehicleCode: vehicle_code,
        make,
        model,
        registrationNumber: registration_number,
        hostName: hostRecord.full_name,
        hostPhone: hostRecord.phone,
        city: city || 'Bengaluru',
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        vehicle: insertedVehicle,
        images: uploadedImages,
      },
    });
  } catch (error: any) {
    console.error('Unexpected error in POST /api/hub/cars/add:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
