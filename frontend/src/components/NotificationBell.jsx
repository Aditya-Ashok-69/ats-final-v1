import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';

export default function NotificationBell() {
  const [data, setData] = useState({ notifications: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const load = () => api.get('/notifications').then(setData).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 30000); // light polling
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const markAll = async () => { await api.post('/notifications/read-all', {}); load(); };

  const openItem = async (n) => {
    if (!n.read) await api.patch(`/notifications/${n.id}/read`, {});
    setOpen(false);
    if (n.link) navigate(n.link);
    load();
  };

  return (
    <div className="bell" ref={ref}>
      <button className="bell-btn" onClick={() => setOpen((o) => !o)} aria-label="Notifications">
        🔔
        {data.unread > 0 && <span className="bell-count">{data.unread}</span>}
      </button>
      {open && (
        <div className="bell-menu card">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && <button className="link-btn" onClick={markAll}>Mark all read</button>}
          </div>
          {data.notifications.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}>Nothing yet.</div>
          ) : (
            data.notifications.map((n) => (
              <button key={n.id} className={`bell-item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <div>{n.message}</div>
                <div className="mono">{new Date(n.createdAt).toLocaleString()}</div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
