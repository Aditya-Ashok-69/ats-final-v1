import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const fromList = (arr) => (Array.isArray(arr) ? arr.join(', ') : arr || '');

const EMPTY_FORM = {
  title: '', department: '', location: '', description: '',
  requiredSkills: '', niceToHaveSkills: '', minYearsExperience: 0,
  scoreThreshold: 70, shortlistThreshold: 70, maxInterviewRounds: 3, autoAdvanceThreshold: 75,
};

function JobModal({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseSuccess, setParseSuccess] = useState(false);
  const fileRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // ── JD upload handler ─────────────────────────────────────────
  const handleJdUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset
    e.target.value = '';
    setError('');
    setParseSuccess(false);
    setParsing(true);

    try {
      const body = new FormData();
      body.append('jd', file);

      const token = localStorage.getItem('ats_token');
      const res = await fetch('/api/jd/parse', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'JD parsing failed.');

      // Auto-fill all fields — recruiter can still edit anything afterwards
      setForm({
        title: data.title || '',
        department: data.department || '',
        location: data.location || '',
        description: data.description || '',
        requiredSkills: fromList(data.requiredSkills),
        niceToHaveSkills: fromList(data.niceToHaveSkills),
        minYearsExperience: data.minYearsExperience ?? 0,
        scoreThreshold: 70,
        shortlistThreshold: 70,
        maxInterviewRounds: 3,
        autoAdvanceThreshold: 75,
      });
      setParseSuccess(true);
    } catch (err) {
      setError(`JD parse failed: ${err.message}`);
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const job = await api.post('/jobs', {
        title: form.title,
        department: form.department,
        location: form.location,
        description: form.description,
        requiredSkills: toList(form.requiredSkills),
        niceToHaveSkills: toList(form.niceToHaveSkills),
        minYearsExperience: Number(form.minYearsExperience) || 0,
        scoreThreshold: Number(form.scoreThreshold),
        shortlistThreshold: Number(form.shortlistThreshold),
        maxInterviewRounds: Number(form.maxInterviewRounds) || 3,
        autoAdvanceThreshold: Number(form.autoAdvanceThreshold) || 75,
      });
      onCreated(job);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <h2>New role</h2>

        {/* ── JD upload zone ── */}
        <div
          className="jd-upload-zone"
          onClick={() => !parsing && fileRef.current?.click()}
          style={{
            border: `2px dashed ${parseSuccess ? 'var(--stage-hired)' : parsing ? 'var(--primary)' : 'var(--line)'}`,
            borderRadius: 10,
            padding: '14px 18px',
            marginBottom: 18,
            cursor: parsing ? 'wait' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: parseSuccess ? 'var(--primary-soft)' : 'var(--bg)',
            transition: 'all 0.2s',
          }}
        >
          <span style={{ fontSize: 22 }}>
            {parsing ? '⏳' : parseSuccess ? '✅' : '📄'}
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {parsing
                ? 'Parsing JD document…'
                : parseSuccess
                ? 'JD parsed — fields auto-filled below. Edit as needed.'
                : 'Upload JD document to auto-fill (PDF or DOCX)'}
            </div>
            {!parsing && !parseSuccess && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                Extracts title, description, required skills, nice-to-have skills, and experience from your document
              </div>
            )}
          </div>
          {!parsing && (
            <button
              className="btn btn-ghost"
              style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap' }}
              onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
            >
              {parseSuccess ? 'Re-upload' : 'Choose file'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx"
            style={{ display: 'none' }}
            onChange={handleJdUpload}
          />
        </div>

        {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="field"><label>Title *</label><input value={form.title} onChange={set('title')} placeholder="e.g. Backend Engineer" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label>Department</label><input value={form.department} onChange={set('department')} /></div>
          <div className="field"><label>Location</label><input value={form.location} onChange={set('location')} /></div>
        </div>
        <div className="field"><label>Job description</label><textarea rows={3} value={form.description} onChange={set('description')} placeholder="Used for resume-to-JD similarity matching" /></div>
        <div className="field">
          <label>Required skills <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>(comma-separated)</span></label>
          <textarea rows={2} value={form.requiredSkills} onChange={set('requiredSkills')} placeholder="Python, AWS, REST API, Git" />
        </div>
        <div className="field">
          <label>Nice-to-have skills <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}>(comma-separated)</span></label>
          <textarea rows={2} value={form.niceToHaveSkills} onChange={set('niceToHaveSkills')} placeholder="Docker, Kubernetes, Terraform" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div className="field"><label>Min years exp</label><input type="number" min="0" value={form.minYearsExperience} onChange={set('minYearsExperience')} /></div>
          <div className="field"><label>Resume auto-advance ≥</label><input type="number" min="0" max="100" value={form.scoreThreshold} onChange={set('scoreThreshold')} /></div>
          <div className="field"><label>Shortlist ≥</label><input type="number" min="0" max="100" value={form.shortlistThreshold} onChange={set('shortlistThreshold')} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label>Max interview rounds (0 = unlimited)</label><input type="number" min="0" max="20" value={form.maxInterviewRounds} onChange={set('maxInterviewRounds')} /></div>
          <div className="field"><label>Interview auto-advance ≥</label><input type="number" min="0" max="100" value={form.autoAdvanceThreshold} onChange={set('autoAdvanceThreshold')} /></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.title}>
            {busy ? 'Creating…' : 'Create role'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const { user } = useAuth();
  const canCreate = user.role === 'ADMIN' || user.role === 'RECRUITER';

  const load = () => api.get('/jobs').then(setJobs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="subtle">All open and active roles</p>
        </div>
        {canCreate && (
          <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ New role</button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {!jobs ? (
          <div className="empty">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="empty">
            No roles yet.{canCreate && ' Click "New role" to create the first one.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Title</th><th>Dept</th><th>Location</th><th>Status</th><th>Applications</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <Link to={`/jobs/${j.id}`} style={{ fontWeight: 600, color: 'var(--primary)' }}>
                      {j.title}
                    </Link>
                  </td>
                  <td>{j.department || '—'}</td>
                  <td>{j.location || '—'}</td>
                  <td><span className={`badge ${j.status.toLowerCase()}`}>{j.status}</span></td>
                  <td>{j._count.applications}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <JobModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}
    </>
  );
}
