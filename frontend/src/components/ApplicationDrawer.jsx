import { useEffect, useState } from 'react';
import { api } from '../api.js';

function ScoreBar({ label, value }) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-track"><div className="score-fill" style={{ width: `${value}%` }} /></div>
      <span className="score-val">{value}</span>
    </div>
  );
}

function EmailDraft({ draft, title = 'Email draft for candidate' }) {
  const [copied, setCopied] = useState(false);
  if (!draft) return null;

  // Supports both plain string (offer letter) and { subject, body } object
  const text = typeof draft === 'string' ? draft : `Subject: ${draft.subject}\n\n${draft.body}`;

  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="draft">
      <div className="draft-head">
        <strong>{title}</strong>
        <button className="link-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      {typeof draft !== 'string' && (
        <div className="mono" style={{ marginBottom: 6 }}>Subject: {draft.subject}</div>
      )}
      <pre className="draft-body">{typeof draft === 'string' ? draft : draft.body}</pre>
    </div>
  );
}

function OfferLetterButton({ applicationId }) {
  const [letter, setLetter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get(`/interviews/offer/${applicationId}`);
      setLetter(res.offerLetter);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {!letter && (
        <button className="btn btn-primary" onClick={generate} disabled={loading} style={{ fontSize: 13 }}>
          {loading ? 'Generating…' : '📄 Generate offer letter'}
        </button>
      )}
      {error && <div className="error" style={{ marginTop: 6, fontSize: 13 }}>{error}</div>}
      {letter && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <strong style={{ fontSize: 13 }}>Offer letter draft</strong>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setLetter(null)}>Hide</button>
          </div>
          <EmailDraft draft={letter} title="Offer letter" />
        </>
      )}
    </div>
  );
}

function ScheduleInterview({ appId, currentRound, maxRounds, onScheduled }) {
  const [users, setUsers] = useState([]);
  const [interviewerId, setInterviewerId] = useState('');
  const [when, setWhen] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { api.get('/users').then(setUsers).catch(() => {}); }, []);

  const atLimit = maxRounds > 0 && currentRound >= maxRounds;

  const schedule = async () => {
    setError('');
    try {
      const res = await api.post(`/applications/${appId}/interviews`, {
        interviewerId,
        scheduledAt: new Date(when).toISOString(),
      });
      onScheduled(res.emailDraft);
      setInterviewerId('');
      setWhen('');
    } catch (e) {
      setError(e.message);
    }
  };

  if (atLimit) {
    return (
      <div className="inset" style={{ background: 'var(--danger-soft)', border: '1px solid var(--danger-soft)' }}>
        <span style={{ color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>
          🚫 Maximum interview rounds reached ({maxRounds}/{maxRounds})
        </span>
        <p className="subtle" style={{ marginTop: 4, fontSize: 12 }}>
          No more rounds can be scheduled. Make an offer decision or reject the candidate.
        </p>
      </div>
    );
  }

  return (
    <div className="inset">
      <strong>Schedule interview {maxRounds > 0 ? `(round ${currentRound + 1} of ${maxRounds})` : `(round ${currentRound + 1})`}</strong>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Interviewer</label>
        <select value={interviewerId} onChange={(e) => setInterviewerId(e.target.value)}>
          <option value="">Select…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
        </select>
      </div>
      <div className="field">
        <label>Date & time</label>
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <button className="btn btn-primary" disabled={!interviewerId || !when} onClick={schedule}>
        Assign interview
      </button>
    </div>
  );
}

function ScorecardForm({ interviewId, onSubmitted }) {
  const [score, setScore] = useState(70);
  const [rec, setRec] = useState('YES');
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    try {
      const res = await api.post(`/interviews/${interviewId}/scorecard`, {
        overallScore: Number(score),
        recommendation: rec,
        comments,
      });
      onSubmitted(res);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="inset">
      <strong>Submit feedback</strong>
      {error && <div className="error" style={{ marginTop: 8 }}>{error}</div>}
      <div className="field" style={{ marginTop: 10 }}>
        <label>Overall score (0–100): {score}</label>
        <input type="range" min="0" max="100" value={score} onChange={(e) => setScore(e.target.value)} />
      </div>
      <div className="field">
        <label>Recommendation</label>
        <select value={rec} onChange={(e) => setRec(e.target.value)}>
          <option value="STRONG_YES">Strong yes</option>
          <option value="YES">Yes</option>
          <option value="NO">No</option>
          <option value="STRONG_NO">Strong no</option>
        </select>
      </div>
      <div className="field">
        <label>Comments</label>
        <textarea rows={3} value={comments} onChange={(e) => setComments(e.target.value)} />
      </div>
      <button className="btn btn-primary" onClick={submit}>Save feedback</button>
    </div>
  );
}

function RoundDecisionBanner({ decision }) {
  if (!decision) return null;

  const { round, average, shortlistThreshold, autoAdvanceThreshold, maxInterviewRounds, shortlisted, atMaxRound, autoAdvanced, nextRound } = decision;

  if (atMaxRound) {
    return (
      <div className={`decision ${shortlisted ? 'good' : 'low'}`} style={{ marginTop: 8 }}>
        🏁 Final round ({round}/{maxInterviewRounds}) complete — avg {average}.{' '}
        {shortlisted
          ? 'Meets shortlist threshold. Ready for offer decision.'
          : 'Below shortlist threshold. Manual review needed.'}
      </div>
    );
  }

  if (autoAdvanced) {
    return (
      <div className="decision good" style={{ marginTop: 8 }}>
        ⚡ Round {round} avg {average} ≥ {autoAdvanceThreshold} — auto-advancing to round {nextRound}.
        Schedule the next interview below.
      </div>
    );
  }

  return (
    <div className={`decision ${shortlisted ? 'good' : 'low'}`} style={{ marginTop: 8 }}>
      Round {round} average {average}/{shortlistThreshold} —{' '}
      {shortlisted ? 'meets the shortlist threshold.' : 'below the shortlist threshold.'}
    </div>
  );
}

export default function ApplicationDrawer({ applicationId, onClose, onChanged }) {
  const [app, setApp] = useState(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState(null);
  const [decision, setDecision] = useState(null);

  const load = () => api.get(`/applications/${applicationId}`).then(setApp).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [applicationId]);

  const b = app?.matchBreakdown;

  // Job-level round config (passed from job record via application)
  const maxRounds = app?.job?.maxInterviewRounds ?? 3;
  const autoAdvThreshold = app?.job?.autoAdvanceThreshold ?? 75;
  const currentRound = app?.currentRound ?? 0;

  // Is candidate at OFFER stage — show offer letter button
  const canGenerateOffer = app?.stage === 'OFFER' || app?.stage === 'INTERVIEW';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {error && <div className="error">{error}</div>}
        {!app ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <div className="drawer-head">
              <div>
                <h2>{app.candidate.name}</h2>
                <div className="subtle">{app.candidate.email} · {app.job.title}</div>
              </div>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>

            {/* Match score */}
            <div className="drawer-section">
              <div className="section-title">
                Match score
                {app.matchScore != null && (
                  <span className={`score-pill ${app.matchScore >= 70 ? 'good' : app.matchScore >= 50 ? 'mid' : 'low'}`}>
                    {app.matchScore}/100
                  </span>
                )}
                {app.flaggedForReview && <span className="badge on_hold" style={{ marginLeft: 8 }}>Flagged for review</span>}
                {app.candidate.resumeUrl && (
                  <a
                    href={`http://localhost:4000${app.candidate.resumeUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    className="link-btn"
                    style={{ marginLeft: 'auto', fontSize: 12 }}
                  >
                    📎 Download resume
                  </a>
                )}
              </div>
              {b ? (
                <div style={{ marginTop: 10 }}>
                  <ScoreBar label="Skill coverage" value={b.skillCoverage} />
                  <ScoreBar label="JD similarity" value={b.similarity} />
                  <ScoreBar label="Experience" value={b.experienceMatch} />
                  <div style={{ marginTop: 10, fontSize: 13 }}>
                    <div><span className="subtle">Matched:</span> {b.matchedSkills?.join(', ') || '—'}</div>
                    <div><span className="subtle">Missing:</span> {b.missingSkills?.join(', ') || '—'}</div>
                    <div className="subtle" style={{ marginTop: 4 }}>Detected experience: {b.yearsDetected} yrs</div>
                  </div>
                </div>
              ) : (
                <p className="subtle" style={{ marginTop: 8 }}>No resume scored for this application.</p>
              )}
            </div>

            {/* Interviews */}
            <div className="drawer-section">
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                Interviews
                {maxRounds > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
                    Round {currentRound} of {maxRounds} max
                    {' · '}Auto-advance ≥ {autoAdvThreshold}
                  </span>
                )}
              </div>

              {app.interviews.length === 0 && <p className="subtle">No interviews scheduled.</p>}

              {app.interviews.map((iv) => (
                <div key={iv.id} className="iv-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <strong>Round {iv.round} · {iv.interviewer.name}</strong>
                    <span className="badge">{iv.status.toLowerCase()}</span>
                  </div>
                  <div className="subtle">{new Date(iv.scheduledAt).toLocaleString()}</div>
                  {iv.scorecard ? (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <span className={`score-pill ${iv.scorecard.overallScore >= 70 ? 'good' : iv.scorecard.overallScore >= 50 ? 'mid' : 'low'}`}>
                        {iv.scorecard.overallScore}/100
                      </span>{' '}
                      {iv.scorecard.recommendation.replace('_', ' ').toLowerCase()}
                      {iv.scorecard.comments && <div className="subtle" style={{ marginTop: 4 }}>{iv.scorecard.comments}</div>}
                    </div>
                  ) : (
                    <ScorecardForm
                      interviewId={iv.id}
                      onSubmitted={(res) => {
                        setDecision({
                          ...res.decision,
                          autoAdvanced: res.autoAdvanced,
                          nextRound: res.decision?.nextRound,
                        });
                        load();
                        onChanged?.();
                      }}
                    />
                  )}
                </div>
              ))}

              <RoundDecisionBanner decision={decision} />

              <ScheduleInterview
                appId={app.id}
                currentRound={currentRound}
                maxRounds={maxRounds}
                onScheduled={(d) => { setDraft(d); load(); onChanged?.(); }}
              />
            </div>

            {/* Offer letter */}
            {canGenerateOffer && (
              <div className="drawer-section">
                <div className="section-title">Offer letter</div>
                <OfferLetterButton applicationId={app.id} />
              </div>
            )}

            <EmailDraft draft={draft} />

            {/* Activity log */}
            <div className="drawer-section">
              <div className="section-title">Activity</div>
              {app.activityLogs.map((log) => (
                <div key={log.id} className="activity-row">
                  <span>{log.action.replace(/_/g, ' ').toLowerCase()}{log.toStage ? ` → ${log.toStage.toLowerCase()}` : ''}</span>
                  <span className="mono">{new Date(log.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
