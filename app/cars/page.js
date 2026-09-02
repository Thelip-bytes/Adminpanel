'use client'
import { useState, useEffect } from "react";
import Link from "next/link";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import toast from "react-hot-toast";
import { useRole } from "../../lib/RoleContext";

export default function Cars() {
  const [selectedCar, setSelectedCar] = useState(null);
  const [actionType, setActionType] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showStatusConfirm, setShowStatusConfirm] = useState(false);
  const { isAdmin, isHost } = useRole();

  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());

  const [cars, setCars] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedCar) return;
    if (toDate <= fromDate) {
      alert("End time must be after start time");
      return;
    }

    setIsSubmitting(true);
    try {
      const formatLocal = (date) => {
        const pad = (n) => n.toString().padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
      };

      const res = await fetch("/api/hub/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vehicle_id: selectedCar.id,
          reason: actionType === "maintain" ? "MAINTENANCE" : "OFFLINE BOOKING",
          start_time: formatLocal(fromDate),
          end_time: formatLocal(toDate),
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setShowConfirm(true);
      } else {
        alert(data.error || "Failed to process request");
      }
    } catch (err) {
      alert("Network error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleStatus = async () => {
    if (!selectedCar) return;
    
    const newStatus = selectedCar.status === 'blocked'; // If blocked, go live (true)

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/hub/cars", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          vehicleId: selectedCar.id,
          available_status: newStatus
        }),
      });

      const data = await res.json();
      if (res.ok) {
        toast.success(`Car is now ${newStatus ? 'Live' : 'Blocked'}`);
        setSelectedCar(null);
        fetchCars(true);
      } else {
        toast.error(data.error || "Failed to update status");
      }
    } catch (err) {
      toast.error("Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const fetchCars = async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    try {
      const res = await fetch(`/api/hub/cars?t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          const STORAGE_BASE_URL = "/api/sb/storage/v1/object/public/car-images/";
          const mappedCars = json.data.map(car => {
            const images = car.vehicle_images || [];
            const primaryImage = images.find((img) => img.is_primary) || images[0];
            let imgUrl = "/cars.jpg";
            if (primaryImage?.image_url) {
              imgUrl = primaryImage.image_url.startsWith("http")
                ? primaryImage.image_url
                : `${STORAGE_BASE_URL}${primaryImage.image_url}`;
            }

            let status = car.available_status ? 'live' : 'blocked';
            if (car.verification_status === 'under_review') {
              status = 'under_review';
            } else if (car.verification_status === 'rejected') {
              status = 'rejected';
            }

            return {
              id: car.id,
              name: `${car.make} ${car.model}`,
              year: car.model_year,
              plate: car.registration_number,
              status,
              verificationStatus: car.verification_status || 'approved',
              hostId: car.host_id || 'N/A',
              hostName: car.hosts?.full_name || 'N/A',
              hostPhone: car.hosts?.phone || 'N/A',
              address: car.location_name || 'Location not provided',
              img: imgUrl
            };
          });
          setCars(mappedCars);
          sessionStorage.setItem('ap_cars', JSON.stringify(mappedCars));
          if (isManual) toast.success("Fleet updated");
        }
      }
    } catch (error) {
      console.error("Failed to fetch cars:", error);
    } finally {
      setIsLoading(false);
      if (isManual) setIsRefreshing(false);
    }
  };

  useEffect(() => {
    const cachedCars = sessionStorage.getItem('ap_cars');
    if (cachedCars) {
      setCars(JSON.parse(cachedCars));
      setIsLoading(false);
    }
    fetchCars(false);

    if (isAdmin) {
      fetch(`/api/hub/cars/pending?t=${Date.now()}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.success && typeof d.count === 'number') {
            setPendingCount(d.count);
          }
        })
        .catch(() => {});
    }
  }, [isAdmin]);

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 className="title" style={{ margin: 0 }}>Cars</h1>
        <button 
          onClick={() => fetchCars(true)} 
          disabled={isRefreshing}
          style={{
            backgroundColor: '#c6a76e',
            color: 'black',
            borderRadius: '18px',
            padding: '6px 16px',
            fontSize: '12px',
            border: 'none',
            cursor: isRefreshing ? 'not-allowed' : 'pointer',
            opacity: isRefreshing ? 0.7 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          {isRefreshing ? (
            <>
              <span className="spinner"></span>
              Syncing Database...
            </>
          ) : (
            '↻ Refresh Dashboard'
          )}
        </button>
      </div>

      {/* Pending Vehicles Notification Banner */}
      {isAdmin && pendingCount > 0 && (
        <div style={{
          background: 'linear-gradient(90deg, rgba(198,167,110,0.15) 0%, rgba(198,167,110,0.05) 100%)',
          border: '1px solid rgba(198,167,110,0.4)',
          borderRadius: '14px',
          padding: '12px 18px',
          marginBottom: '20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '18px' }}>⚡</span>
            <span style={{ fontSize: '13px', color: '#e0e0e0', fontWeight: '500' }}>
              <b>{pendingCount} new host vehicle{pendingCount > 1 ? 's' : ''}</b> awaiting image verification & pricing setup.
            </span>
          </div>
          <Link href="/verify-cars" style={{
            background: '#c6a76e',
            color: '#000',
            textDecoration: 'none',
            fontSize: '12px',
            fontWeight: '700',
            padding: '6px 14px',
            borderRadius: '10px',
            display: 'inline-block'
          }}>
            Review Approvals →
          </Link>
        </div>
      )}

      {/* ================= STATUS TOGGLE CONFIRM ================= */}
      {showStatusConfirm && selectedCar && (
        <div 
          className="popup-overlay" 
          onClick={() => setShowStatusConfirm(false)}
          style={{ 
            alignItems: 'flex-start', 
            paddingTop: '40px',
            zIndex: 9999999 /* Ultra high priority */
          }}
        >
          <div className="status-confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="status-icon-wrapper">
               <img 
                 src="/block.png" 
                 className="status-icon-large" 
                 style={{ filter: selectedCar.status === 'live' ? 'none' : 'hue-rotate(90deg)' }}
               />
            </div>
            <div className="status-content">
              <h3>{selectedCar.status === 'live' ? 'Block Vehicle?' : 'Go Live?'}</h3>
              <p>
                Confirm {selectedCar.status === 'live' ? 'blocking' : 'unblocking'} <b>{selectedCar.name}</b>?
              </p>
            </div>
            
            <div className="status-confirm-actions">
              <button 
                className="btn-secondary" 
                onClick={() => setShowStatusConfirm(false)}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button 
                className={`btn-primary ${selectedCar.status === 'live' ? 'danger' : 'success'}`}
                onClick={async () => {
                   await handleToggleStatus();
                   setShowStatusConfirm(false);
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Processing..." : (selectedCar.status === 'live' ? 'Yes, Block' : 'Yes, Go Live')}
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .status-confirm-box {
          background: white;
          padding: 12px 18px;
          border-radius: 16px;
          width: 95%;
          max-width: 480px;
          text-align: left;
          box-shadow: 0 10px 40px rgba(0,0,0,0.2);
          animation: slideDown 0.4s cubic-bezier(0.16, 1, 0.3, 1);
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .status-icon-wrapper {
          width: 50px;
          height: 50px;
          background: #f8f9fa;
          border-radius: 15px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .status-icon-large {
          width: 24px;
          height: 24px;
        }
        .status-content {
          flex-grow: 1;
        }
        .status-confirm-box h3 {
          margin: 0;
          font-size: 16px;
          color: #1a1a1a;
          font-weight: 700;
        }
        .status-confirm-box p {
          color: #666;
          font-size: 12px;
          margin: 2px 0 0;
          line-height: 1.4;
        }
        .status-confirm-actions {
          display: flex;
          gap: 8px;
          flex-shrink: 0;
        }
        .status-confirm-actions button {
          padding: 8px 16px;
          border-radius: 10px;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }
        .btn-secondary {
          background: #f1f3f5;
          color: #495057;
        }
        .btn-secondary:hover {
          background: #e9ecef;
        }
        .btn-primary.danger {
          background: #ff4d4d;
          color: white;
        }
        .btn-primary.success {
          background: #28a745;
          color: white;
        }
        .btn-primary:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }
        @keyframes slideDown {
          from { transform: translateY(-40px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .spinner {
          width: 14px;
          height: 14px;
          border: 2px solid #000;
          border-bottom-color: transparent;
          border-radius: 50%;
          display: inline-block;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {isLoading ? (
        <p style={{ padding: "20px" }}>Loading cars...</p>
      ) : (
        <div className="cars-grid">
          {cars.map((car) => (
            <div className="car-card" key={car.id}>
              <div className="car-top-section">
                <img src={car.img} className="car-img" alt={car.name} />
                <div className="car-right">
                  <h3 className="car-title">
                    {car.name} <span>( {car.year} )</span>
                  </h3>
                  <span className="plate">{car.plate}</span>
                  <div className="status-row">
                    <span className={`status ${car.status}`}>
                      {car.status === 'under_review' ? 'under review' : car.status}
                    </span>
                    {(isAdmin || isHost) && (
                    <span
                      className="menu-dot"
                      onClick={() => {
                        setSelectedCar(car);
                        setActionType(null);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      ⋮
                    </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="divider"></div>
              <div className="car-details">
                <div className="details-col left">
                  <p><b>Host ID:</b> #{car.hostId}</p>
                  <p><b>Host Name:</b> {car.hostName}</p>
                  <p><b>Host Phone:</b> {car.hostPhone}</p>
                </div>
                <div className="details-col right">
                  <p>
                    <b>Host Address:</b> {car.address}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ================= POPUP 1 ================= */}
      {selectedCar && !actionType && (
        <div className="popup-overlay" onClick={() => setSelectedCar(null)}>
          <div className="popup-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="popup-title">
              {selectedCar.name} <span>( {selectedCar.year} )</span>
            </h3>
            <div className="popup-plate">
              {selectedCar.plate}
            </div>
            <div className="popup-actions">
              {isAdmin && (
                <div 
                  className="popup-item" 
                  onClick={() => setShowStatusConfirm(true)}
                  style={{ opacity: isSubmitting ? 0.5 : 1, cursor: isSubmitting ? 'not-allowed' : 'pointer' }}
                >
                  <img src="/block.png" style={{ filter: selectedCar.status === 'live' ? 'none' : 'hue-rotate(90deg)' }} />
                  <span>{selectedCar.status === 'live' ? 'BLOCK' : 'GO LIVE'}</span>
                </div>
              )}
              <div className="popup-item" onClick={() => setActionType("maintain")}>
                <img src="/maintain.png" />
                <span>MAINTENANCE</span>
              </div>
              {!isHost && (
              <div className="popup-item" onClick={() => setActionType("offline-booking")}>
                <img src="/pause.png" />
                <span>OFFLINE BOOKING</span>
              </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= POPUP 2 ================= */}
      {selectedCar && actionType && (
        <div className="popup-overlay" onClick={() => setActionType(null)}>
          <div className="form-popup" onClick={(e) => e.stopPropagation()}>
            <div className="form-header">
              <img src={actionType === "offline-booking" ? "/pause.png" : "/maintain.png"} className="form-icon" />
              <h3>{actionType === "offline-booking" ? "OFFLINE BOOKING" : "MAINTENANCE"}</h3>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>FROM</label>
                <DatePicker
                  selected={fromDate}
                  onChange={(date) => setFromDate(date)}
                  showTimeSelect
                  timeIntervals={60}
                  dateFormat="dd-MM-yyyy HH:mm:ss"
                  className="custom-datepicker"
                  popperClassName="custom-datepicker-popper"
                />
              </div>
              <div className="form-group">
                <label>TO</label>
                <DatePicker
                  selected={toDate}
                  onChange={(date) => setToDate(date)}
                  showTimeSelect
                  timeIntervals={60}
                  dateFormat="dd-MM-yyyy HH:mm:ss"
                  className="custom-datepicker"
                  popperClassName="custom-datepicker-popper"
                />
              </div>
            </div>
            <div className="form-group full">
              <label>REASON</label>
              <div style={{ 
                background: actionType === "maintain" ? '#fff3cd' : '#d4edda', 
                color: actionType === "maintain" ? '#856404' : '#155724', 
                padding: '10px', 
                borderRadius: '8px', 
                fontSize: '12px', 
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: actionType === "maintain" ? '1px solid #ffeeba' : '1px solid #c3e6cb'
              }}>
                {actionType === "maintain" ? "⚙️ MAINTENANCE" : "📅 OFFLINE BOOKING"}
              </div>
            </div>
            <div className="form-actions">
              <button className="cancel" onClick={() => setActionType(null)}>Cancel</button>
              <button className="submit" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= CONFIRM POPUP ================= */}
      {showConfirm && (
        <div className="popup-overlay" onClick={() => setShowConfirm(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h3>SUCCESS</h3>
            <p>Request submitted successfully</p>
            <div className="confirm-details">
              <div>
                <span>FROM</span>
                <p>{fromDate.toLocaleString()}</p>
              </div>
              <div>
                <span>TO</span>
                <p>{toDate.toLocaleString()}</p>
              </div>
            </div>
            <button onClick={() => { setShowConfirm(false); setSelectedCar(null); setActionType(null); fetchCars(true); }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
