import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

function JobModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    title: '', department: '', location: '', description: '',
    requiredSkills: '', niceToHaveSkills: '', minYearsExperience: 0,
    scoreThreshold: 70, shortlistThreshold: 70, maxInterviewRounds: 3, autoAdvanceThreshold: 75,
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const toList = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);

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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>New role</h2>
        {error && <div className="error">{error}</div>}
        <div className="field"><label>Title</label><input value={form.title} onChange={set('title')} placeholder="e.g. Backend Engineer" /></div>
        <div className="field"><label>Department</label><input value={form.department} onChange={set('department')} /></div>
        <div className="field"><label>Location</label><input value={form.location} onChange={set('location')} /></div>
        <div className="field"><label>Job description</label><textarea rows={3} value={form.description} onChange={set('description')} placeholder="Used for resume-to-JD similarity matching" /></div>
        <div className="field"><label>Required skills (comma-separated)</label><input value={form.requiredSkills} onChange={set('requiredSkills')} placeholder="React, TypeScript, Node.js" /></div>
        <div className="field"><label>Nice-to-have skills</label><input value={form.niceToHaveSkills} onChange={set('niceToHaveSkills')} placeholder="Docker, AWS" /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <div className="field"><label>Min years exp</label><input type="number" min="0" value={form.minYearsExperience} onChange={set('minYearsExperience')} /></div>
          <div className="field"><label>Auto-advance ≥</label><input type="number" min="0" max="100" value={form.scoreThreshold} onChange={set('scoreThreshold')} /></div>
          <div className="field"><label>Shortlist ≥</label><input type="number" min="0" max="100" value={form.shortlistThreshold} onChange={set('shortlistThreshold')} /></div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label>Max interview rounds</label><input type="number" min="0" max="20" value={form.maxInterviewRounds} onChange={set('maxInterviewRounds')} /></div>
          <div className="field"><label>Interview auto-advance ≥</label><input type="number" min="0" max="100" value={form.autoAdvanceThreshold} onChange={set('autoAdvanceThreshold')} /></div>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || !form.title}>Create role</button>
        </div>
      </div>
    </div>
  );
}

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreate = user.role === 'ADMIN' || user.role === 'RECRUITER';

  const load = () => api.get('/jobs').then(setJobs).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="subtle">Open and historical roles</p>
        </div>
        {canCreate && <button className="btn btn-primary" onClick={() => setShowModal(true)}>New role</button>}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {!jobs ? (
          <div className="empty">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="empty">No roles yet. Create your first one to start tracking applicants.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Role</th><th>Department</th><th>Location</th><th>Applicants</th><th>Status</th></tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/jobs/${job.id}`)}>
                  <td style={{ fontWeight: 600 }}>{job.title}</td>
                  <td>{job.department || '—'}</td>
                  <td>{job.location || '—'}</td>
                  <td>{job._count.applications}</td>
                  <td><span className={`badge ${job.status.toLowerCase()}`}>{job.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <JobModal
          onClose={() => setShowModal(false)}
          onCreated={(job) => { setShowModal(false); navigate(`/jobs/${job.id}`); }}
        />
      )}
    </>
  );
}
