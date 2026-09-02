'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect } from 'react'
import { useRole } from '../lib/RoleContext'

export default function Sidebar() {
  const path = usePathname()
  const [open, setOpen] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const { isHost } = useRole()

  const fetchPendingCount = async () => {
    if (isHost) return;
    try {
      const res = await fetch(`/api/hub/cars/pending?t=${Date.now()}`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && typeof json.count === 'number') {
          setPendingCount(json.count);
        }
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchPendingCount();
    // Refresh periodically every 60s
    const interval = setInterval(fetchPendingCount, 60000);
    return () => clearInterval(interval);
  }, [isHost, path]);

  const handleLogout = async () => {
    await fetch("/api/hub/logout", { method: "POST" }).catch(() => {});
    sessionStorage.clear()
    window.location.reload()
  }

  return (
    <>
      {/* 🔥 MOBILE TOP BAR (ONLY LOGO + HAMBURGER) */}
      <div className="mobile-nav">

        <img src="/logo.png" className="logo-img mobile-logo" />

        <div
          className={`hamburger ${open ? 'active' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <span></span>
          <span></span>
          <span></span>
        </div>

      </div>

      {/* 🔥 SIDEBAR */}
      <div className={`sidebar ${open ? 'open' : ''}`}>

        <div>
          <div className="logo desktop-logo">
            <img src="/logo.png" className="logo-img" />
          </div>

          <div className="menu">

            <Link href="/" className={`item ${path==='/'?'active':''}`} onClick={()=>setOpen(false)}>Home</Link>

            <Link href="/cars" className={`item ${path==='/cars'?'active':''}`} onClick={()=>setOpen(false)}>Cars</Link>

            <Link href="/bookings" className={`item ${path==='/bookings'?'active':''}`} onClick={()=>setOpen(false)}>Bookings</Link>

            <Link href="/maintainance" className={`item ${path==='/maintainance'?'active':''}`} onClick={()=>setOpen(false)}>Maintainace</Link>

            {!isHost && (
              <Link href="/offline-booking" className={`item ${path==='/offline-booking'?'active':''}`} onClick={()=>setOpen(false)}>Offline Booking</Link>
            )}

            {!isHost && (
              <Link 
                href="/verify-cars" 
                className={`item ${path==='/verify-cars'?'active':''}`} 
                onClick={()=>setOpen(false)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <span>Verify Cars</span>
                {pendingCount > 0 && (
                  <span style={{
                    background: '#c6a76e',
                    color: '#000',
                    fontSize: '11px',
                    fontWeight: '700',
                    padding: '2px 7px',
                    borderRadius: '10px',
                    lineHeight: '1.2'
                  }}>
                    {pendingCount}
                  </span>
                )}
              </Link>
            )}

            <Link href="/profile" className={`item ${path==='/profile'?'active':''}`} onClick={()=>setOpen(false)}>Profile</Link>

          </div>
        </div>

        <button className="logout" onClick={handleLogout}>Logout</button>

      </div>

      {/* OVERLAY */}
      {open && <div className="overlay" onClick={() => setOpen(false)} />}
    </>
  )
}