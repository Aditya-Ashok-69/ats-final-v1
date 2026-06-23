import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

function CandidateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', source: '' });
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async () => {
    setError('');
    try {
      const c = await api.post('/candidates', form);
      onCreated(c);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New candidate</h2>
        {error && <div className="error">{error}</div>}
        <div className="field"><label>Name</label><input value={form.name} onChange={set('name')} /></div>
        <div className="field"><label>Email</label><input type="email" value={form.email} onChange={set('email')} /></div>
        <div className="field"><label>Phone</label><input value={form.phone} onChange={set('phone')} /></div>
        <div className="field">
          <label>Source</label>
          <select value={form.source} onChange={set('source')}>
            <option value="">—</option>
            <option>LinkedIn</option>
            <option>Referral</option>
            <option>Careers Page</option>
            <option>Other</option>
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!form.name || !form.email}>Add candidate</button>
        </div>
      </div>
    </div>
  );
}

function MergeModal({ candidates, onClose, onMerged }) {
  const [primaryId, setPrimaryId] = useState('');
  const [duplicateId, setDuplicateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!primaryId || !duplicateId) return;
    if (primaryId === duplicateId) { setError('Pick two different candidates.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await api.post('/candidates/merge', { primaryId, duplicateId });
      onMerged(res);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const primary = candidates.find((c) => c.id === primaryId);
  const duplicate = candidates.find((c) => c.id === duplicateId);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Merge duplicate candidates</h2>
        <p className="subtle" style={{ marginBottom: 16, fontSize: 13 }}>
          All applications from the duplicate will move to the primary record. The duplicate is then deleted.
          If both applied to the same job, the primary's application is kept.
        </p>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Primary (keep this record)</label>
          <select value={primaryId} onChange={(e) => setPrimaryId(e.target.value)}>
            <option value="">Select candidate to keep…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Duplicate (will be deleted)</label>
          <select value={duplicateId} onChange={(e) => setDuplicateId(e.target.value)}>
            <option value="">Select candidate to remove…</option>
            {candidates.filter((c) => c.id !== primaryId).map((c) => (
              <option key={c.id} value={c.id}>{c.name} — {c.email}</option>
            ))}
          </select>
        </div>
        {primary && duplicate && (
          <div style={{ background: 'var(--danger-soft)', borderRadius: 8, padding: '10px 14px', fontSize: 13, marginBottom: 12 }}>
            ⚠️ This will permanently delete <strong>{duplicate.name}</strong> ({duplicate.email}) and move their{' '}
            {duplicate._count?.applications ?? '?'} application(s) to <strong>{primary.name}</strong>.
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-danger"
            onClick={submit}
            disabled={busy || !primaryId || !duplicateId || primaryId === duplicateId}
          >
            {busy ? 'Merging…' : 'Merge candidates'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Candidates() {
  const [candidates, setCandidates] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [mergeResult, setMergeResult] = useState(null);
  const { user } = useAuth();
  const canCreate = user.role === 'ADMIN' || user.role === 'RECRUITER';

  const load = (query = '') =>
    api.get(`/candidates${query ? `?q=${encodeURIComponent(query)}` : ''}`)
      .then(setCandidates)
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Candidates</h1>
          <p className="subtle">Everyone in your talent pool</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canCreate && (
            <button className="btn btn-ghost" onClick={() => { setShowMerge(true); setMergeResult(null); }}>
              Merge duplicates
            </button>
          )}
          {canCreate && (
            <button className="btn btn-primary" onClick={() => setShowModal(true)}>New candidate</button>
          )}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {mergeResult && (
        <div style={{ background: 'var(--primary-soft)', borderRadius: 8, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>
          ✓ Merge complete — {mergeResult.transferredApplications} application(s) transferred,{' '}
          {mergeResult.deletedConflictApplications} duplicate application(s) removed.
        </div>
      )}

      <div className="toolbar">
        <input placeholder="Search by name or email…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card">
        {!candidates ? (
          <div className="empty">Loading…</div>
        ) : candidates.length === 0 ? (
          <div className="empty">No candidates match. Add one to get started.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Phone</th><th>Source</th><th>Applications</th></tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.email}</td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.source ? <span className="chip">{c.source}</span> : '—'}</td>
                  <td>{c._count.applications}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <CandidateModal onClose={() => setShowModal(false)} onCreated={() => { setShowModal(false); load(q); }} />
      )}

      {showMerge && candidates && (
        <MergeModal
          candidates={candidates}
          onClose={() => setShowMerge(false)}
          onMerged={(res) => { setShowMerge(false); setMergeResult(res); load(q); }}
        />
      )}
    </>
  );
}
