'use client';

import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useRole } from '../../lib/RoleContext';
import { PRICING_TIERS } from '../../lib/pricing';
import './verify-cars.css';

export default function VerifyCarsPage() {
  const { isAdmin, isHost } = useRole();
  const [vehicles, setVehicles] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Per-vehicle pricing inputs: { [vehicleId]: number }
  const [rates, setRates] = useState({});
  // Per-vehicle makeLive checkboxes: { [vehicleId]: boolean }
  const [makeLiveState, setMakeLiveState] = useState({});

  // Submitting state per vehicle: { [vehicleId]: boolean }
  const [submittingIds, setSubmittingIds] = useState({});

  // Lightbox state
  const [lightbox, setLightbox] = useState(null); // { url, label }

  // Rejection modal state
  const [rejectingCar, setRejectingCar] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const REJECTION_PRESETS = [
    'Blurry or low-resolution car photos',
    'Registration plate does not match vehicle',
    'Missing interior cabin photos',
    'Incorrect vehicle model or specifications',
    'Visible pre-existing body damage without documentation'
  ];

  const fetchPendingCars = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/hub/cars/pending?t=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to fetch pending approvals');

      const json = await res.json();
      if (json.success && json.data) {
        const STORAGE_BASE_URL = '/api/sb/storage/v1/object/public/car-images/';
        const mapped = json.data.map((car) => {
          const rawImages = car.vehicle_images || [];
          const images = rawImages.map((img) => {
            const url = img.image_url.startsWith('http')
              ? img.image_url
              : `${STORAGE_BASE_URL}${img.image_url}`;
            return {
              id: img.id,
              url,
              isPrimary: img.is_primary,
              rawName: img.image_url
            };
          });

          const primary = images.find((i) => i.isPrimary) || images[0];

          return {
            ...car,
            coverImg: primary?.url || '/cars.jpg',
            gallery: images,
            formattedDate: new Date(car.created_at).toLocaleString('en-IN', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            })
          };
        });

        setVehicles(mapped);

        // Initialize default rates & makeLive states
        const initialRates = {};
        const initialLive = {};
        mapped.forEach((v) => {
          initialRates[v.id] = v.base_daily_rate && v.base_daily_rate > 0 ? v.base_daily_rate : 2200;
          initialLive[v.id] = true;
        });
        setRates((prev) => ({ ...initialRates, ...prev }));
        setMakeLiveState((prev) => ({ ...initialLive, ...prev }));

        if (isManual) toast.success('Verification queue refreshed');
      }
    } catch (err) {
      console.error('Fetch pending cars error:', err);
      toast.error('Failed to load pending queue');
    } finally {
      setIsLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPendingCars();
  }, []);

  const handleRateChange = (vehicleId, val) => {
    const num = Math.max(0, parseInt(val, 10) || 0);
    setRates((prev) => ({ ...prev, [vehicleId]: num }));
  };

  const handleToggleLive = (vehicleId) => {
    setMakeLiveState((prev) => ({ ...prev, [vehicleId]: !prev[vehicleId] }));
  };

  const handleApprove = async (vehicle, forceOffline = false) => {
    const rate = rates[vehicle.id];
    if (!rate || rate <= 0) {
      toast.error('Please enter a valid base daily rate (₹) greater than 0');
      return;
    }

    const shouldMakeLive = forceOffline ? false : makeLiveState[vehicle.id] !== false;

    setSubmittingIds((prev) => ({ ...prev, [vehicle.id]: true }));
    try {
      const res = await fetch('/api/hub/cars/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: vehicle.id,
          action: 'approve',
          base_daily_rate: rate,
          make_available: shouldMakeLive
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(
          `${vehicle.make} ${vehicle.model} approved and ${shouldMakeLive ? 'promoted to LIVE fleet' : 'saved as BLOCKED'}`
        );
        // Remove from pending list
        setVehicles((prev) => prev.filter((v) => v.id !== vehicle.id));
      } else {
        toast.error(data.error || 'Failed to approve vehicle');
      }
    } catch (err) {
      console.error('Approval request failed:', err);
      toast.error('Network error during approval');
    } finally {
      setSubmittingIds((prev) => ({ ...prev, [vehicle.id]: false }));
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectingCar) return;
    if (!rejectionReason.trim()) {
      toast.error('Please provide a reason for rejecting the vehicle');
      return;
    }

    setSubmittingIds((prev) => ({ ...prev, [rejectingCar.id]: true }));
    try {
      const res = await fetch('/api/hub/cars/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vehicleId: rejectingCar.id,
          action: 'reject',
          rejection_notes: rejectionReason.trim()
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        toast.success(`Vehicle ${rejectingCar.make} ${rejectingCar.model} rejected`);
        setVehicles((prev) => prev.filter((v) => v.id !== rejectingCar.id));
        setRejectingCar(null);
        setRejectionReason('');
      } else {
        toast.error(data.error || 'Failed to reject vehicle');
      }
    } catch (err) {
      console.error('Rejection request error:', err);
      toast.error('Network error during rejection');
    } finally {
      setSubmittingIds((prev) => ({ ...prev, [rejectingCar?.id]: false }));
    }
  };

  // Filter vehicles by search query
  const filteredVehicles = vehicles.filter((car) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = `${car.make} ${car.model}`.toLowerCase();
    const plate = (car.registration_number || '').toLowerCase();
    const host = (car.hosts?.full_name || '').toLowerCase();
    const city = (car.city || '').toLowerCase();
    return name.includes(q) || plate.includes(q) || host.includes(q) || city.includes(q);
  });

  return (
    <div className="container verify-page">
      {/* HEADER BAR */}
      <div className="verify-header">
        <div className="verify-title-group">
          <h1 className="verify-title">Car Verification & Pricing</h1>
          <span className="verify-count-pill">
            <span className="pulse-dot"></span>
            {vehicles.length} Pending Review
          </span>
        </div>

        <div className="verify-actions-bar">
          <input
            type="text"
            className="verify-search-input"
            placeholder="Search by car, plate, host..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button
            className="verify-refresh-btn"
            onClick={() => fetchPendingCars(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? '↻ Syncing...' : '↻ Refresh Queue'}
          </button>
        </div>
      </div>

      {/* CONTENT / LIST */}
      {isLoading ? (
        <div className="verify-empty-state">
          <span className="verify-empty-icon">⏳</span>
          <h3>Loading verification queue...</h3>
        </div>
      ) : filteredVehicles.length === 0 ? (
        <div className="verify-empty-state">
          <span className="verify-empty-icon">✓</span>
          <h3>All caught up!</h3>
          <p>
            {searchQuery
              ? 'No pending vehicles match your search query.'
              : 'There are currently no host vehicles awaiting verification.'}
          </p>
        </div>
      ) : (
        <div className="verify-cards-list">
          {filteredVehicles.map((car) => {
            const currentRate = rates[car.id] || 2200;
            const isSubmitting = !!submittingIds[car.id];

            return (
              <div className="verify-car-card" key={car.id}>
                {/* CARD HEADER */}
                <div className="verify-card-header">
                  <div className="car-primary-info">
                    <h2>
                      {car.make} {car.model} <span>({car.model_year})</span>
                    </h2>
                    <div className="car-meta-subtitle">
                      <span className="plate-badge">{car.registration_number}</span>
                      <span>•</span>
                      <span>{car.city || 'Bengaluru'}</span>
                      <span>•</span>
                      <span>Code: {car.vehicle_code || `#${car.id}`}</span>
                    </div>
                  </div>

                  <div className="car-header-badges">
                    <span className="status-badge-review">Under Review</span>
                    <span className="time-tag">Submitted {car.formattedDate}</span>
                  </div>
                </div>

                {/* CARD BODY: PHOTOS + SPECS */}
                <div className="verify-card-body">
                  {/* LEFT: GALLERY INSPECTOR */}
                  <div className="verify-gallery-section">
                    <div className="gallery-label">Uploaded Vehicle Photos (Click to Enlarge)</div>
                    <div
                      className="gallery-main-preview"
                      onClick={() => setLightbox({ url: car.coverImg, label: `${car.make} ${car.model} - Cover Photo` })}
                    >
                      <img src={car.coverImg} alt={`${car.make} cover`} />
                      <div className="gallery-main-overlay">
                        <span>Cover Photo</span>
                        <span>🔍 Click to inspect</span>
                      </div>
                    </div>

                    <div className="gallery-thumbnails-row">
                      {car.gallery.slice(0, 4).map((img, idx) => {
                        const labels = ['Angle 1', 'Angle 2', 'Angle 3', 'Interior'];
                        return (
                          <div
                            className="gallery-thumb"
                            key={img.id || idx}
                            onClick={() =>
                              setLightbox({
                                url: img.url,
                                label: `${car.make} ${car.model} - ${labels[idx] || `Photo ${idx + 1}`}`
                              })
                            }
                          >
                            <img src={img.url} alt={`Thumbnail ${idx}`} />
                            <span className="thumb-tag">{labels[idx] || `Photo ${idx + 1}`}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* RIGHT: SPECS, HOST & PRICING SETUP */}
                  <div className="verify-info-section">
                    {/* HOST DETAILS */}
                    <div className="info-block">
                      <div className="info-block-title">👤 Host Information</div>
                      <div className="host-details-row">
                        <div>
                          <span className="host-name">{car.hosts?.full_name || 'N/A'}</span>
                          <span style={{ color: '#777', marginLeft: '6px' }}>#{car.host_id}</span>
                        </div>
                        {car.hosts?.phone && (
                          <a href={`tel:${car.hosts.phone}`} className="host-phone-link">
                            📞 +91 {car.hosts.phone}
                          </a>
                        )}
                      </div>
                      <div className="location-snippet">
                        <span>📍</span>
                        <span>{car.location_name || 'Location not specified'}</span>
                      </div>
                    </div>

                    {/* VEHICLE SPECS */}
                    <div className="info-block">
                      <div className="info-block-title">🚗 Vehicle Specifications</div>
                      <div className="specs-grid">
                        <div className="spec-item">
                          Body: <span>{car.vehicle_type || 'SUV'}</span>
                        </div>
                        <div className="spec-item">
                          Fuel: <span>{car.fuel_type || 'Petrol'}</span>
                        </div>
                        <div className="spec-item">
                          Transmission: <span>{car.transmission_type || 'Manual'}</span>
                        </div>
                        <div className="spec-item">
                          Capacity: <span>{car.seating_capacity || 5} Seats</span>
                        </div>
                        <div className="spec-item">
                          Mileage: <span>{car.mileage_kmpl || 15} km/l</span>
                        </div>
                        <div className="spec-item">
                          Color: <span>{car.color || 'Standard'}</span>
                        </div>
                      </div>
                    </div>

                    {/* VEHICLE DESCRIPTION */}
                    {car.description && (
                      <div className="info-block">
                        <div className="info-block-title">📝 Vehicle Description ({car.description.length} characters)</div>
                        <p style={{ fontSize: '13px', color: '#ddd', lineHeight: '1.5', margin: '6px 0 0 0', whiteSpace: 'pre-wrap', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)' }}>
                          {car.description}
                        </p>
                      </div>
                    )}

                    {/* PRICING INPUT & LIVE CALCULATOR */}
                    <div className="verify-pricing-card">
                      <div className="pricing-input-wrapper">
                        <label htmlFor={`rate-${car.id}`}>Set Base Daily Rate:</label>
                        <div className="pricing-currency-box">
                          <span>₹</span>
                          <input
                            id={`rate-${car.id}`}
                            type="number"
                            min="500"
                            step="50"
                            value={currentRate}
                            onChange={(e) => handleRateChange(car.id, e.target.value)}
                            placeholder="e.g. 2500"
                          />
                        </div>
                      </div>

                      {/* TIER BREAKDOWN PREVIEW */}
                      <div style={{ fontSize: '11px', color: '#aaa', fontWeight: '600' }}>
                        Live Tier Pricing Breakdown (based on ₹{currentRate.toLocaleString('en-IN')}/day):
                      </div>
                      <div className="tier-preview-grid">
                        {/* Tier 1: 6-12h */}
                        <div className="tier-box">
                          <div className="tier-box-name">6–12 Hours</div>
                          <div className="tier-box-rate">
                            ₹{Math.round(currentRate * (1 + PRICING_TIERS.TIER_1.priceAdjustment)).toLocaleString('en-IN')}
                          </div>
                          <div className="tier-box-adj">+100% surge</div>
                        </div>

                        {/* Tier 2: 12-24h */}
                        <div className="tier-box">
                          <div className="tier-box-name">12–24 Hours</div>
                          <div className="tier-box-rate">
                            ₹{Math.round(currentRate * (1 + PRICING_TIERS.TIER_2.priceAdjustment)).toLocaleString('en-IN')}
                          </div>
                          <div className="tier-box-adj">+67% surge</div>
                        </div>

                        {/* Tier 3: 1-2 Days (Base) */}
                        <div className="tier-box" style={{ borderColor: '#c6a76e' }}>
                          <div className="tier-box-name" style={{ color: '#c6a76e' }}>1–2 Days (Base)</div>
                          <div className="tier-box-rate">₹{currentRate.toLocaleString('en-IN')}</div>
                          <div className="tier-box-adj">Daily Rate</div>
                        </div>

                        {/* Tier 4: 3-6 Days */}
                        <div className="tier-box">
                          <div className="tier-box-name">3–6 Days</div>
                          <div className="tier-box-rate">
                            ₹{Math.round(currentRate * (1 + PRICING_TIERS.TIER_4.priceAdjustment)).toLocaleString('en-IN')}/d
                          </div>
                          <div className="tier-box-adj">-5% discount</div>
                        </div>

                        {/* Tier 5: Weekly */}
                        <div className="tier-box">
                          <div className="tier-box-name">7–13 Days</div>
                          <div className="tier-box-rate">
                            ₹{Math.round(currentRate * (1 + PRICING_TIERS.TIER_5.priceAdjustment)).toLocaleString('en-IN')}/d
                          </div>
                          <div className="tier-box-adj">-15% discount</div>
                        </div>

                        {/* Tier 6: Monthly */}
                        <div className="tier-box">
                          <div className="tier-box-name">14–29 Days</div>
                          <div className="tier-box-rate">
                            ₹{Math.round(currentRate * (1 + PRICING_TIERS.TIER_6.priceAdjustment)).toLocaleString('en-IN')}/d
                          </div>
                          <div className="tier-box-adj">-20% discount</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* CARD FOOTER: ACTIONS */}
                <div className="verify-card-footer">
                  <label className="make-live-checkbox">
                    <input
                      type="checkbox"
                      checked={makeLiveState[car.id] !== false}
                      onChange={() => handleToggleLive(car.id)}
                    />
                    <span>Promote to Available (Go live immediately in customer app)</span>
                  </label>

                  <div className="verify-action-buttons">
                    <button
                      className="btn-reject-car"
                      onClick={() => {
                        setRejectingCar(car);
                        setRejectionReason('');
                      }}
                      disabled={isSubmitting}
                    >
                      ✕ Reject
                    </button>

                    <button
                      className="btn-approve-offline"
                      onClick={() => handleApprove(car, true)}
                      disabled={isSubmitting}
                    >
                      Approve as Blocked
                    </button>

                    <button
                      className="btn-approve-live"
                      onClick={() => handleApprove(car, false)}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? 'Approving...' : '✓ Approve & Promote to Live'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ================= LIGHTBOX MODAL ================= */}
      {lightbox && (
        <div className="verify-lightbox-overlay" onClick={() => setLightbox(null)}>
          <button className="lightbox-close-btn" onClick={() => setLightbox(null)}>
            ✕
          </button>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.label} />
          </div>
          <div className="lightbox-caption">{lightbox.label}</div>
        </div>
      )}

      {/* ================= REJECTION MODAL ================= */}
      {rejectingCar && (
        <div className="verify-lightbox-overlay" onClick={() => setRejectingCar(null)}>
          <div className="reject-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="reject-modal-header">
              <span style={{ fontSize: '24px' }}>⚠️</span>
              <div>
                <h3>Reject Vehicle Listing</h3>
                <p style={{ color: '#888', fontSize: '12px', margin: 0 }}>
                  {rejectingCar.make} {rejectingCar.model} ({rejectingCar.registration_number})
                </p>
              </div>
            </div>

            <p style={{ fontSize: '13px', color: '#ccc', margin: '0 0 10px 0' }}>
              Select a quick preset or type specific feedback for host {rejectingCar.hosts?.full_name}:
            </p>

            <div className="reject-presets-chips">
              {REJECTION_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="preset-chip"
                  onClick={() => setRejectionReason(preset)}
                >
                  + {preset}
                </button>
              ))}
            </div>

            <textarea
              className="reject-textarea"
              placeholder="Detailed reason for rejection..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />

            <div className="reject-modal-actions">
              <button
                type="button"
                className="btn-approve-offline"
                onClick={() => setRejectingCar(null)}
                disabled={submittingIds[rejectingCar.id]}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-reject-car"
                style={{ background: '#dc3545', color: '#fff' }}
                onClick={handleRejectSubmit}
                disabled={submittingIds[rejectingCar.id]}
              >
                {submittingIds[rejectingCar.id] ? 'Submitting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
