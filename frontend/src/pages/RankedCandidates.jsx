/**
 * RankedCandidates — per-job view showing every applicant sorted by match score,
 * with checkboxes and a bulk "Advance to stage" action.
 *
 * Route: /jobs/:id/ranked
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';

const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];
const STAGE_LABELS = {
  APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview',
  OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected',
};

function scoreColor(s) {
  if (s == null) return 'var(--muted)';
  if (s >= 70) return 'var(--stage-hired)';
  if (s >= 50) return 'var(--stage-screening)';
  return 'var(--danger)';
}

function SkillChips({ skills = [], matchedSkills = [], missingSkills = [] }) {
  if (!skills.length && !matchedSkills.length) return null;

  // Prefer breakdown matched/missing over raw skills list
  const matched = matchedSkills.length ? matchedSkills : skills;
  const missing = missingSkills;

  return (
    <div className="chips" style={{ marginTop: 4, flexWrap: 'wrap', gap: 4 }}>
      {matched.map((s) => (
        <span key={s} className="chip" style={{ background: 'var(--primary-soft)', color: 'var(--primary)', fontSize: 11 }}>{s}</span>
      ))}
      {missing.map((s) => (
        <span key={s} className="chip" style={{ background: 'var(--danger-soft)', color: 'var(--danger)', fontSize: 11, textDecoration: 'line-through', opacity: 0.8 }}>{s}</span>
      ))}
    </div>
  );
}

function ScoreBreakdownBar({ label, value }) {
  if (value == null) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
      <span style={{ fontSize: 11, color: 'var(--muted)', width: 100, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 5, background: 'var(--line)', borderRadius: 3 }}>
        <div style={{ width: `${value}%`, height: '100%', borderRadius: 3, background: scoreColor(value) }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, width: 28, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

function CandidateRow({ app, selected, onToggle, rank, threshold }) {
  const [expanded, setExpanded] = useState(false);
  const bd = app.breakdown;
  const aboveThreshold = app.matchScore != null && app.matchScore >= threshold;

  return (
    <>
      <tr
        className={selected ? 'ranked-row selected' : 'ranked-row'}
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded((v) => !v)}
      >
        <td onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(app.id)}
            style={{ cursor: 'pointer', width: 16, height: 16 }}
          />
        </td>
        <td style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 12 }}>#{rank}</td>
        <td>
          <div style={{ fontWeight: 600 }}>{app.candidate.name}</div>
          <div style={{ color: 'var(--muted)', fontSize: 12 }}>{app.candidate.email}</div>
        </td>
        <td>
          <span
            className="score-pill"
            style={{
              background: scoreColor(app.matchScore),
              color: '#fff',
              fontSize: 13,
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 20,
            }}
          >
            {app.matchScore ?? '—'}
          </span>
          {aboveThreshold && (
            <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--stage-hired)', color: '#fff', borderRadius: 10, padding: '2px 6px' }}>
              ✓ Threshold
            </span>
          )}
        </td>
        <td>
          <span className="chip" style={{ fontSize: 11 }}>{STAGE_LABELS[app.stage] || app.stage}</span>
          {app.flaggedForReview && <span className="chip flag" style={{ fontSize: 11, marginLeft: 4 }}>Review</span>}
        </td>
        <td style={{ color: 'var(--muted)', fontSize: 12 }}>
          {app.candidate.parseEngine === 'structured' ? (
            <span title="Scored using LLM-extracted structured data" style={{ color: 'var(--primary)', fontWeight: 600 }}>⚡ AI</span>
          ) : app.candidate.parseEngine === 'fallback' ? (
            <span title="Scored using text-only fallback (parser unavailable)" style={{ color: 'var(--muted)' }}>Text</span>
          ) : '—'}
        </td>
        <td style={{ color: 'var(--muted)', fontSize: 12 }}>
          {app.candidate.technicalExperienceYears != null
            ? `${app.candidate.technicalExperienceYears}y tech`
            : app.candidate.totalExperienceYears != null
            ? `${app.candidate.totalExperienceYears}y total`
            : bd?.yearsDetected != null
            ? `${bd.yearsDetected}y (est)`
            : '—'}
        </td>
        <td style={{ color: 'var(--muted)', fontSize: 12 }}>
          {new Date(app.appliedAt).toLocaleDateString()}
        </td>
        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr className="ranked-expand">
          <td colSpan={9} style={{ padding: '12px 16px 16px', background: 'var(--primary-soft)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--primary)' }}>Score Breakdown</div>
                <ScoreBreakdownBar label="Skill Coverage" value={bd?.skillCoverage} />
                <ScoreBreakdownBar label="JD Similarity" value={bd?.similarity} />
                <ScoreBreakdownBar label="Experience" value={bd?.experienceMatch} />
                {bd?.experienceSource && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                    Experience source: {bd.experienceSource}
                  </div>
                )}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6, color: 'var(--primary)' }}>Skills</div>
                <SkillChips
                  matchedSkills={bd?.matchedSkills || []}
                  missingSkills={bd?.missingSkills || []}
                />
                {bd?.matchedNiceToHave?.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 4 }}>Nice-to-have matched:</div>
                    <div className="chips" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {bd.matchedNiceToHave.map((s) => (
                        <span key={s} className="chip" style={{ background: 'var(--gold-soft)', color: 'var(--gold)', fontSize: 11 }}>{s}</span>
                      ))}
                    </div>
                  </>
                )}
                {app.candidate.resumeUrl && (
                  <a
                    href={`http://localhost:4000${app.candidate.resumeUrl}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'inline-block', marginTop: 10, fontSize: 12, color: 'var(--primary)', textDecoration: 'underline' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    View resume ↗
                  </a>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function RankedCandidates() {
  const { id: jobId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Filters
  const [stageFilter, setStageFilter] = useState('');
  const [minScore, setMinScore] = useState('');

  // Selection
  const [selected, setSelected] = useState(new Set());

  // Bulk advance UI
  const [toStage, setToStage] = useState('SCREENING');
  const [advancing, setAdvancing] = useState(false);
  const [advanceMsg, setAdvanceMsg] = useState('');

  // Top-N helper
  const [topN, setTopN] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setSelected(new Set());
    setAdvanceMsg('');
    const qs = new URLSearchParams();
    if (stageFilter) qs.set('stage', stageFilter);
    if (minScore) qs.set('minScore', minScore);
    api.get(`/ranking/${jobId}?${qs}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [jobId, stageFilter, minScore]);

  useEffect(() => { load(); }, [load]);

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    setAdvanceMsg('');
  };

  const toggleAll = () => {
    if (!data) return;
    if (selected.size === data.ranked.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.ranked.map((a) => a.id)));
    }
    setAdvanceMsg('');
  };

  const selectTopN = () => {
    const n = parseInt(topN, 10);
    if (!data || isNaN(n) || n < 1) return;
    setSelected(new Set(data.ranked.slice(0, n).map((a) => a.id)));
    setAdvanceMsg('');
  };

  const selectAboveThreshold = () => {
    if (!data) return;
    const t = data.job.scoreThreshold;
    setSelected(new Set(data.ranked.filter((a) => (a.matchScore ?? 0) >= t).map((a) => a.id)));
    setAdvanceMsg('');
  };

  const advance = async () => {
    if (!selected.size) return;
    setAdvancing(true);
    setAdvanceMsg('');
    try {
      const result = await api.post(`/ranking/${jobId}/advance`, {
        applicationIds: [...selected],
        toStage,
      });
      setAdvanceMsg(`✓ ${result.advanced} candidate${result.advanced !== 1 ? 's' : ''} advanced to ${STAGE_LABELS[toStage]}${result.skipped ? ` (${result.skipped} already there)` : ''}.`);
      load();
    } catch (e) {
      setAdvanceMsg(`Error: ${e.message}`);
    } finally {
      setAdvancing(false);
    }
  };

  if (error) return <div className="error">{error}</div>;
  if (!data && loading) return <div className="empty">Loading ranked candidates…</div>;
  if (!data) return null;

  const { job, ranked } = data;
  const allSelected = ranked.length > 0 && selected.size === ranked.length;

  return (
    <>
      {/* Page header */}
      <div className="page-head">
        <div>
          <Link to={`/jobs/${jobId}`} className="subtle">← Kanban board</Link>
          <h1 style={{ marginTop: 4 }}>Ranked Candidates — {job.title}</h1>
          <p className="subtle">
            {ranked.length} applicant{ranked.length !== 1 ? 's' : ''} · Auto-advance threshold: {job.scoreThreshold}
            {job.minYearsExperience > 0 && ` · Min experience: ${job.minYearsExperience}y`}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: '14px 18px', marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ margin: 0, minWidth: 140 }}>
          <label>Stage</label>
          <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {PIPELINE_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 120 }}>
          <label>Min score</label>
          <input type="number" min={0} max={100} placeholder="0–100" value={minScore} onChange={(e) => setMinScore(e.target.value)} />
        </div>
        <button className="btn btn-ghost" onClick={load} style={{ marginBottom: 1 }}>Apply filter</button>
        <button className="btn btn-ghost" onClick={() => { setStageFilter(''); setMinScore(''); }} style={{ marginBottom: 1 }}>Clear</button>
      </div>

      {/* Bulk action toolbar */}
      <div className="card" style={{ padding: '12px 18px', marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: selected.size ? 'var(--primary-soft)' : 'var(--surface)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>SELECT</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={toggleAll}>
            {allSelected ? 'Deselect all' : 'All'}
          </button>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={selectAboveThreshold}>
            ≥ Threshold ({job.scoreThreshold})
          </button>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="number"
              min={1}
              placeholder="N"
              value={topN}
              onChange={(e) => setTopN(e.target.value)}
              style={{ width: 56, padding: '5px 8px', fontSize: 12 }}
            />
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={selectTopN}>Top N</button>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {selected.size} selected
          </span>
          <select
            value={toStage}
            onChange={(e) => setToStage(e.target.value)}
            style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}
          >
            {PIPELINE_STAGES.filter((s) => s !== 'APPLIED').map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
          <button
            className="btn btn-primary"
            disabled={!selected.size || advancing}
            onClick={advance}
            style={{ fontSize: 12, padding: '6px 14px' }}
          >
            {advancing ? 'Advancing…' : `Advance →`}
          </button>
        </div>

        {advanceMsg && (
          <div style={{ width: '100%', fontSize: 12, color: advanceMsg.startsWith('Error') ? 'var(--danger)' : 'var(--stage-hired)', fontWeight: 600 }}>
            {advanceMsg}
          </div>
        )}
      </div>

      {/* Ranked table */}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : ranked.length === 0 ? (
        <div className="empty">No applicants match the current filters.</div>
      ) : (
        <div className="card" style={{ overflow: 'auto' }}>
          <table className="table" style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{ width: 16, height: 16 }}
                  />
                </th>
                <th>#</th>
                <th>Candidate</th>
                <th>Score</th>
                <th>Stage</th>
                <th>Engine</th>
                <th>Experience</th>
                <th>Applied</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((app) => (
                <CandidateRow
                  key={app.id}
                  app={app}
                  rank={app.rank}
                  threshold={job.scoreThreshold}
                  selected={selected.has(app.id)}
                  onToggle={toggleOne}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
