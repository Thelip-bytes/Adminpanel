'use client'

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, formatBytes } from "../../lib/imageCompressor";
import "./addcarimages.css";
import "../add-car-flow.css";

export default function AddCarImages() {
  const router = useRouter();

  const [agree, setAgree] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [images, setImages] = useState({
    main: null,
    front: null,
    back: null,
    side: null,
    inside: null
  });

  const [preview, setPreview] = useState({
    main: "",
    front: "",
    back: "",
    side: "",
    inside: ""
  });

  const [compressing, setCompressing] = useState({
    main: false,
    front: false,
    back: false,
    side: false,
    inside: false
  });

  const [compressionStats, setCompressionStats] = useState({
    main: null,
    front: null,
    back: null,
    side: null,
    inside: null
  });

  const [showSuccess, setShowSuccess] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => () => {
    Object.values(preview).forEach((url) => url && URL.revokeObjectURL(url));
  }, [preview]);

  const handleImage = async (e, key) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setFormError("Please choose a valid image file (JPG, PNG, WebP, or HEIC).");
      e.target.value = "";
      return;
    }

    // High upper limit (50MB) since client will compress it down to ~300KB
    if (file.size > 50 * 1024 * 1024) {
      setFormError("The selected image is over 50 MB. Please choose a smaller photo.");
      e.target.value = "";
      return;
    }

    setFormError("");
    setCompressing((prev) => ({ ...prev, [key]: true }));

    try {
      // Compress large photos to lightweight WebP (max 1920x1080, quality 0.82)
      const result = await compressImage(file, {
        maxWidth: 1920,
        maxHeight: 1080,
        quality: 0.82,
        targetType: 'image/webp'
      });

      if (preview[key]) URL.revokeObjectURL(preview[key]);

      setImages((prev) => ({
        ...prev,
        [key]: result.file
      }));

      setPreview((prev) => ({
        ...prev,
        [key]: result.previewUrl
      }));

      setCompressionStats((prev) => ({
        ...prev,
        [key]: {
          original: formatBytes(result.originalSize),
          compressed: formatBytes(result.compressedSize),
          saved: result.compressionRatio
        }
      }));
    } catch (err) {
      console.error("Image compression error:", err);
      // Fallback to original file if compression somehow fails
      setImages((prev) => ({
        ...prev,
        [key]: file
      }));
      setPreview((prev) => ({
        ...prev,
        [key]: URL.createObjectURL(file)
      }));
    } finally {
      setCompressing((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!images.main) {
      setFormError("Add a main cover image before submitting your vehicle.");
      return;
    }
    if (!agree) {
      setFormError("Confirm that the vehicle insurance is active before submitting.");
      return;
    }

    // Retrieve saved steps from sessionStorage
    const step1Raw = sessionStorage.getItem("add_car_step1");
    const step2Raw = sessionStorage.getItem("add_car_step2");
    const step3Raw = sessionStorage.getItem("add_car_step3");

    if (!step1Raw || !step2Raw || !step3Raw) {
      setFormError("Your saved details are incomplete. Please start again from vehicle details.");
      router.push("/add-car");
      return;
    }

    try {
      const step1 = JSON.parse(step1Raw);
      const step2 = JSON.parse(step2Raw);
      const step3 = JSON.parse(step3Raw);

      if (!step2.description || step2.description.trim().length < 168) {
        setFormError(`Car description must be at least 168 characters (currently ${step2.description?.trim().length || 0}/168). Please go back to step 2 to complete it.`);
        return;
      }

      setIsSubmitting(true);

      const formData = new FormData();

      // Step 1 fields
      formData.append("make", step1.brand || "");
      formData.append("model", step1.carName || "");
      formData.append("model_year", step1.year || new Date().getFullYear().toString());
      formData.append("color", step1.color || "");
      formData.append("vehicle_type", step1.vehicleType || "SUV");
      formData.append("fuel_type", step1.fuelType || "Petrol");
      formData.append("transmission_type", step1.transmission || "Manual");
      formData.append("seating_capacity", step1.seats || "5");
      if (step1.hostId) formData.append("host_id", step1.hostId);

      // Step 2 fields
      formData.append("mileage_kmpl", step2.mileage || "15");
      formData.append("registration_number", step2.registration || "");
      formData.append("description", step2.description || "");
      if (step2.baseDailyRate) formData.append("base_daily_rate", step2.baseDailyRate);

      // Step 3 fields
      formData.append("city", step3.city || "Bengaluru");
      formData.append("door_no", step3.doorNo || "");
      formData.append("street", step3.street || "");
      formData.append("area", step3.area || "");
      formData.append("district", step3.district || "");
      formData.append("state", step3.state || "");
      formData.append("pincode", step3.pincode || "");
      formData.append(
        "location_name",
        [step3.doorNo, step3.street, step3.area, step3.city, step3.district, step3.state, step3.pincode]
          .filter(Boolean)
          .join(", ") || "Hub Location"
      );

      // Image files (lightweight WebP blobs)
      if (images.main) formData.append("main", images.main);
      if (images.front) formData.append("front", images.front);
      if (images.back) formData.append("rear", images.back); // map back to rear
      if (images.side) formData.append("side", images.side);
      if (images.inside) formData.append("interior", images.inside); // map inside to interior

      const res = await fetch("/api/hub/cars/add", {
        method: "POST",
        body: formData
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        // Clear wizard state
        sessionStorage.removeItem("add_car_step1");
        sessionStorage.removeItem("add_car_step2");
        sessionStorage.removeItem("add_car_step3");

        setShowSuccess(true);
        setTimeout(() => {
          router.push("/cars");
        }, 2400);
      } else {
        setFormError(data.error || "We could not add this vehicle. Your details and photos are preserved, please try again.");
      }
    } catch (err) {
      console.error("Add vehicle submit error:", err);
      setFormError("The upload could not reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const UploadBox = (title, key, required = false) => {
    const isCurrentlyCompressing = compressing[key];
    const stat = compressionStats[key];

    return (
      <div className="adding-car-upload-field">
        <label className="adding-car-label">
          {title}
          {required && <span className="adding-car-required">Required</span>}
        </label>
        <label className="adding-car-upload-box" style={{ position: 'relative' }}>
          {isCurrentlyCompressing ? (
            <div style={{ textAlign: 'center', padding: '15px 0' }}>
              <div className="adding-car-upload-icon" style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⚡</div>
              <div style={{ fontSize: '12px', color: '#c6a76e', fontWeight: '600', marginTop: '4px' }}>
                Optimizing Photo...
              </div>
            </div>
          ) : preview[key] ? (
            <img src={preview[key]} className="adding-car-preview" alt={`${title} preview`} />
          ) : (
            <>
              <div className="adding-car-upload-icon">☁</div>
              <span className="adding-car-upload-btn">Upload File</span>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={isCurrentlyCompressing}
            onChange={(e) => handleImage(e, key)}
          />
        </label>

        {/* Compression Statistics Badge */}
        {stat && !isCurrentlyCompressing && (
          <div style={{ 
            fontSize: '11px', 
            color: '#c6a76e', 
            marginTop: '4px', 
            display: 'flex', 
            alignItems: 'center', 
            gap: '6px' 
          }}>
            <span>✓ Compressed:</span>
            <span style={{ color: '#888', textDecoration: 'line-through' }}>{stat.original}</span>
            <span>→</span>
            <span style={{ color: '#28a745', fontWeight: '600' }}>{stat.compressed}</span>
            {stat.saved > 0 && <span style={{ color: '#28a745' }}>(-{stat.saved}%)</span>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="adding-car-page">
      <div className="adding-car-card">
        <div className="adding-car-progress" aria-label="Step 4 of 4"><span className="complete">1</span><i className="complete"></i><span className="complete">2</span><i className="complete"></i><span className="complete">3</span><i className="complete"></i><span className="active">4</span><b>Photos and submission</b></div>
        <div className="adding-car-header">
          <h1 className="adding-car-title">Provide Your Vehicle Photos</h1>
          <p className="adding-car-subtitle">
            Add a clear cover photo and all recommended angles. Large camera photos will be automatically optimized before upload.
          </p>
        </div>

        <form className="adding-car-form" onSubmit={handleSubmit}>
          {formError && <div className="adding-car-alert" role="alert">{formError}</div>}
          {UploadBox("Add Main Cover Image", "main", true)}
          {UploadBox("Add Front Car Image", "front")}
          {UploadBox("Add Back Car Image", "back")}
          {UploadBox("Add Side Car Image", "side")}
          {UploadBox("Add Inside Car Image", "inside")}

          <div className="adding-car-terms">
            <label>
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
              />
              <span>
                I agree to the Company's Terms & Conditions and confirm that my car insurance is active and valid.
              </span>
            </label>
          </div>

          <div className="adding-car-bottom">
            <button className="adding-car-back" type="button" disabled={isSubmitting} onClick={() => router.back()}>Back</button>
            <button
              type="submit"
              className="adding-car-btn"
              disabled={isSubmitting || Object.values(compressing).some(Boolean)}
            >
              {isSubmitting ? "UPLOADING & SAVING..." : "FINALIZE AND ADD"}
            </button>
          </div>
        </form>
      </div>

      {showSuccess && (
        <div className="adding-car-success-overlay">
          <div className="adding-car-success-box">
            <div className="adding-car-success-icon">✓</div>
            <h2 className="adding-car-success-h">Car Submitted Successfully</h2>
            <p className="adding-car-success-p">
              Your vehicle has been submitted for admin verification and pricing setup. Once approved, it will go live on Miles!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
