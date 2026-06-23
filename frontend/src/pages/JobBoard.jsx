import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import ApplicationDrawer from '../components/ApplicationDrawer.jsx';

const COLUMNS = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];
const LABELS = { APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview', OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected' };

function scoreClass(s) {
  if (s == null) return '';
  return s >= 70 ? 'good' : s >= 50 ? 'mid' : 'low';
}

function CandidateCard({ app, onDragStart, onDragEnd, dragging, onOpen }) {
  return (
    <div
      className={`cand-card ${dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, app)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(app.id)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 }}>
        <div className="name">{app.candidate.name}</div>
        {app.matchScore != null && <span className={`score-pill ${scoreClass(app.matchScore)}`}>{app.matchScore}</span>}
      </div>
      <div className="meta">{app.candidate.email}</div>
      <div className="chips">
        {app.flaggedForReview && <span className="chip flag">Review</span>}
        {app.candidate.source && <span className="chip">{app.candidate.source}</span>}
        {app._count.notes > 0 && <span className="chip">{app._count.notes} notes</span>}
      </div>
    </div>
  );
}

function AddToPipeline({ jobId, onAdded }) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (open) api.get('/candidates').then(setCandidates).catch(() => {}); }, [open]);

  const add = async () => {
    setError('');
    try {
      await api.post('/applications', { candidateId: selected, jobId });
      setOpen(false); setSelected(''); onAdded();
    } catch (e) { setError(e.message); }
  };

  if (!open) return <button className="btn btn-ghost" onClick={() => setOpen(true)}>Add candidate</button>;

  return (
    <div className="overlay" onClick={() => setOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add candidate to pipeline</h2>
        {error && <div className="error">{error}</div>}
        <div className="field">
          <label>Candidate</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a candidate…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.email}</option>)}
          </select>
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={add} disabled={!selected}>Add to pipeline</button>
        </div>
      </div>
    </div>
  );
}

export default function JobBoard() {
  const { id } = useParams();
  const [job, setJob] = useState(null);
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [draggingId, setDraggingId] = useState(null);
  const [overStage, setOverStage] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadBoard = useCallback(() => {
    api.get(`/applications/board/${id}`).then(setBoard).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    api.get(`/jobs/${id}`).then(setJob).catch((e) => setError(e.message));
    loadBoard();
  }, [id, loadBoard]);

  const onDragStart = (e, app) => {
    setDraggingId(app.id);
    e.dataTransfer.setData('text/plain', JSON.stringify({ id: app.id, from: app.stage }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragEnd = () => { setDraggingId(null); setOverStage(null); };

  const onDrop = async (e, toStage) => {
    e.preventDefault();
    setOverStage(null);
    const payload = JSON.parse(e.dataTransfer.getData('text/plain') || '{}');
    if (!payload.id || payload.from === toStage) return;

    setBoard((prev) => {
      const next = {};
      let moved;
      for (const [stage, apps] of Object.entries(prev)) {
        next[stage] = apps.filter((a) => { if (a.id === payload.id) { moved = a; return false; } return true; });
      }
      if (moved) next[toStage] = [{ ...moved, stage: toStage }, ...next[toStage]];
      return next;
    });

    try {
      await api.patch(`/applications/${payload.id}/stage`, { stage: toStage });
    } catch (err) { setError(err.message); loadBoard(); }
  };

  const copyApplyLink = () => {
    const url = `${window.location.origin}/apply/${id}`;
    navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) return <div className="error">{error}</div>;
  if (!job || !board) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/jobs" className="subtle">← Jobs</Link>
          <h1 style={{ marginTop: 4 }}>{job.title}</h1>
          <p className="subtle">
            {[job.department, job.location].filter(Boolean).join(' · ') || 'No details'}
            {job.requiredSkills?.length > 0 && ` · Auto-advance ≥ ${job.scoreThreshold}`}
          </p>
        </div>
        <div className="row-actions">
          <Link to={`/jobs/${id}/ranked`} className="btn btn-ghost">📊 Ranked view</Link>
          <button className="btn btn-ghost" onClick={copyApplyLink}>{copied ? 'Link copied' : 'Copy apply link'}</button>
          <AddToPipeline jobId={id} onAdded={loadBoard} />
        </div>
      </div>

      <div className="board">
        {COLUMNS.map((stage) => (
          <div
            key={stage}
            className={`column ${overStage === stage ? 'drag-over' : ''}`}
            data-stage={stage}
            onDragOver={(e) => { e.preventDefault(); setOverStage(stage); }}
            onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
            onDrop={(e) => onDrop(e, stage)}
          >
            <div className="column-head">
              <h3>{LABELS[stage]}</h3>
              <span className="count">{board[stage]?.length || 0}</span>
            </div>
            <div className="column-body">
              {(board[stage] || []).map((app) => (
                <CandidateCard
                  key={app.id}
                  app={app}
                  dragging={draggingId === app.id}
                  onDragStart={onDragStart}
                  onDragEnd={onDragEnd}
                  onOpen={setOpenId}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {board.REJECTED?.length > 0 && (
        <p className="subtle" style={{ marginTop: 16 }}>{board.REJECTED.length} rejected</p>
      )}

      {openId && (
        <ApplicationDrawer
          applicationId={openId}
          onClose={() => setOpenId(null)}
          onChanged={loadBoard}
        />
      )}
    </>
  );
}
