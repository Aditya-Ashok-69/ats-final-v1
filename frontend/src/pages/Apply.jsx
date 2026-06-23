import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

export default function Apply() {
  const { jobId } = useParams();
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    fetch(`/api/public/jobs/${jobId}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setJob(d)))
      .catch(() => setError('Could not load this role.'));
  }, [jobId]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const body = new FormData();
    body.append('name', form.name);
    body.append('email', form.email);
    body.append('phone', form.phone);
    if (file) body.append('resume', file);

    try {
      const res = await fetch(`/api/public/jobs/${jobId}/apply`, { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      setResult(data);
    } catch (err) {
      setError(err.message);
      setBusy(false); // make sure button re-enables so they can fix the error
    } finally {
      setBusy(false);
    }
  };

  if (error && !job) return <div className="auth-wrap"><div className="auth-card"><div className="error">{error}</div></div></div>;
  if (!job) return <div className="auth-wrap"><div className="auth-card">Loading…</div></div>;

  if (result) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ maxWidth: 440, textAlign: 'center' }}>
          <div className="brand" style={{ color: 'var(--ink)', justifyContent: 'center' }}><span className="dot" /> Hiretrack</div>
          <h2 style={{ marginBottom: 10 }}>Application received</h2>
          <p className="subtle" style={{ marginBottom: 0 }}>{result.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" style={{ maxWidth: 440 }} onSubmit={submit}>
        <div className="brand" style={{ color: 'var(--ink)', justifyContent: 'center' }}><span className="dot" /> Hiretrack</div>
        <h2 style={{ textAlign: 'center', marginBottom: 4 }}>{job.title}</h2>
        <p className="subtle" style={{ textAlign: 'center', marginBottom: 18 }}>
          {[job.department, job.location].filter(Boolean).join(' · ')}
        </p>
        {error && <div className="error">{error}</div>}
        <div className="field"><label>Full name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div className="field"><label>Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
        <div className="field"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        <div className="field">
          <label>Resume (PDF or DOCX)</label>
          <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !form.name || !form.email}>
          {busy ? 'Submitting…' : 'Submit application'}
        </button>
      </form>
    </div>
  );
}
