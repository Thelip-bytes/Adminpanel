"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { ShieldCheck, User } from "lucide-react";
import toast from "react-hot-toast";
import { RoleProvider } from "../lib/RoleContext";

export default function AuthWrapper({ children }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [selectedRole, setSelectedRole] = useState(null);
  const [availableRoles, setAvailableRoles] = useState([]);

  // Login state
  const [loginStep, setLoginStep] = useState(1);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState(["", "", "", ""]);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/hub/session");
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.user) {
            setIsAdmin(true);
            setAdminData(data.user);
            sessionStorage.setItem("admin_info", JSON.stringify(data.user));
          } else {
            sessionStorage.removeItem("admin_info");
          }
        } else {
          sessionStorage.removeItem("admin_info");
        }
      } catch (e) {
        sessionStorage.removeItem("admin_info");
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const handleRequestOtp = async (role = selectedRole) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length !== 10 && !(digits.length === 12 && digits.startsWith("91"))) {
      toast.error("Enter a valid 10-digit phone number");
      return;
    }
    setIsLoggingIn(true);

    try {
      const res = await fetch("/api/hub/auth/request-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, role }),
      });
      const data = await res.json().catch(() => ({}));

      if (data.requiresRoleChoice) {
        setAvailableRoles(data.roles || []);
        toast("Please select your portal account", { icon: "ℹ️" });
      } else if (res.ok && data.success) {
        setSelectedRole(data.role);
        setLoginStep(2);
        toast.success(`OTP sent to WhatsApp for ${data.role === 'host' ? 'Host' : 'Admin'} Portal`);
      } else {
        toast.error(data.error || "Access Denied");
      }
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleVerifyOtp = async (entered = otp.join("")) => {
    if (entered.length < 4) return;
    setIsLoggingIn(true);
    try {
      const res = await fetch("/api/hub/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp: entered, role: selectedRole }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        sessionStorage.setItem("admin_info", JSON.stringify(data.admin));
        // Notify RoleProvider immediately of role update
        window.dispatchEvent(new Event("storage"));
        setAdminData(data.admin);
        setIsAdmin(true);
        toast.success(`Welcome, ${data.admin.name || "User"}`);
      } else {
        toast.error(data.error || "Invalid OTP");
      }
    } catch {
      toast.error("Verification failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleOtpChange = (value, index) => {
    if (/^\d?$/.test(value)) {
      const newOtp = [...otp];
      newOtp[index] = value;
      setOtp(newOtp);
      if (value && index < 3) document.getElementById(`otp-hub-${index + 1}`)?.focus();
      if (newOtp.every((d) => d !== "")) handleVerifyOtp(newOtp.join(""));
    }
  };

  const handleOtpPaste = (e) => {
    const pasted = e.clipboardData.getData("text").trim();
    if (/^\d{4}$/.test(pasted)) {
      setOtp(pasted.split(""));
      handleVerifyOtp(pasted);
      document.getElementById("otp-hub-3")?.focus();
    }
    e.preventDefault();
  };

  if (loading) return null;

  if (!isAdmin) {
    return (
      <main className="portal-login-container">
        <div className="portal-login-card">
          <div className="portal-logo">
            <Image src="/mlogo.png" alt="MM Miles" width={140} height={42} />
          </div>
          <h1 className="portal-title">HUB OPS</h1>
          <p className="portal-subtitle">Secure access for fleet operations</p>

          {loginStep === 1 ? (
            <div>
              <div className="portal-form-group">
                <label className="portal-label">Phone Number</label>
                <div style={{ position: "relative" }}>
                  <span className="phone-prefix">+91</span>
                  <input
                    type="tel"
                    className="portal-input"
                    placeholder="Enter 10-digit number"
                    style={{ paddingLeft: "3.5rem" }}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, ""));
                      if (availableRoles.length > 0) {
                        setAvailableRoles([]);
                        setSelectedRole(null);
                      }
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleRequestOtp()}
                    maxLength={12}
                  />
                </div>
              </div>

              {availableRoles.length > 1 && (
                <div style={{ margin: "16px 0" }}>
                  <p style={{ fontSize: "12px", color: "#c6a76e", margin: "0 0 8px 0", textAlign: "center", fontWeight: "600" }}>
                    Select which portal to access:
                  </p>
                  <div className="login-tabs" aria-label="Choose portal">
                    <button
                      type="button"
                      className={`login-tab ${selectedRole === 'admin' ? 'active' : ''}`}
                      onClick={() => { setSelectedRole('admin'); handleRequestOtp('admin'); }}
                      disabled={isLoggingIn}
                    >
                      Admin Portal
                    </button>
                    <button
                      type="button"
                      className={`login-tab ${selectedRole === 'host' ? 'active' : ''}`}
                      onClick={() => { setSelectedRole('host'); handleRequestOtp('host'); }}
                      disabled={isLoggingIn}
                    >
                      Host Portal
                    </button>
                  </div>
                </div>
              )}

              {availableRoles.length <= 1 && (
                <button
                  type="button"
                  className="portal-btn"
                  onClick={() => handleRequestOtp()}
                  disabled={isLoggingIn}
                >
                  {isLoggingIn ? "Sending Code..." : "Send Verification Code"}
                </button>
              )}
            </div>
          ) : (
            <div>
              <p className="otp-sent-text">
                OTP sent to <strong>+91 {phone.replace(/^91/, "")}</strong>
                {selectedRole && (
                  <span style={{ display: "block", fontSize: "11px", color: "#c6a76e", marginTop: "4px" }}>
                    Logging into: {selectedRole === 'host' ? 'Host Portal' : 'Admin Portal'}
                  </span>
                )}
              </p>
              <div className="otp-display-group">
                {otp.map((digit, i) => (
                  <input
                    key={i} id={`otp-hub-${i}`} type="text" inputMode="numeric" maxLength={1}
                    className="otp-box-portal" value={digit}
                    onChange={(e) => handleOtpChange(e.target.value, i)}
                    onPaste={handleOtpPaste}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !otp[i] && i > 0) document.getElementById(`otp-hub-${i - 1}`)?.focus();
                    }}
                  />
                ))}
              </div>
              <button type="button" className="portal-btn" onClick={() => handleVerifyOtp()} disabled={isLoggingIn}>
                {isLoggingIn ? "Verifying..." : "Access Portal"}
              </button>
              <p className="go-back-link" onClick={() => { setLoginStep(1); setOtp(["","","",""]); setSelectedRole(null); setAvailableRoles([]); }}>← Go Back</p>
            </div>
          )}
          <div className="secured-badge">
            <ShieldCheck size={14} /> <span>Secured by OTP Verification</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <RoleProvider>
      <header className="portal-header" style={{ background: 'transparent', boxShadow: 'none', padding: '0 0 20px 0', position: 'absolute', top: '35px', right: '40px', zIndex: 10 }}>
        <div className="portal-header-left">
          <span className="portal-admin-tag">
            <User size={12} /> {adminData?.name || "Hub Admin"}
            <span style={{
              marginLeft: '6px',
              fontSize: '9px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '10px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              background: adminData?.role === 'operator' ? '#e8f4fd' : (adminData?.role === 'host' ? '#e8f5e9' : '#fef3e2'),
              color: adminData?.role === 'operator' ? '#1976d2' : (adminData?.role === 'host' ? '#2e7d32' : '#c6a76e'),
              border: adminData?.role === 'operator' ? '1px solid #bbdefb' : (adminData?.role === 'host' ? '1px solid #c8e6c9' : '1px solid #f5deb3'),
            }}>
              {adminData?.role === 'operator' ? 'Operator' : (adminData?.role === 'host' ? 'Host' : 'Admin')}
            </span>
          </span>
        </div>
      </header>
      {children}
    </RoleProvider>
  );
}
