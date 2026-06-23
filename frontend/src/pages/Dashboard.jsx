import { useEffect, useState } from 'react';
import { api } from '../api.js';

const STAGE_LABELS = {
  APPLIED: 'Applied', SCREENING: 'Screening', INTERVIEW: 'Interview',
  OFFER: 'Offer', HIRED: 'Hired', REJECTED: 'Rejected',
};

function ScoreHistogram({ buckets }) {
  if (!buckets || buckets.every((b) => b.count === 0)) {
    return <p className="subtle" style={{ fontSize: 13 }}>No scored applications yet.</p>;
  }
  const max = Math.max(1, ...buckets.map((b) => b.count));

  const barColor = (min) => {
    if (min >= 70) return 'var(--stage-hired)';
    if (min >= 50) return 'var(--stage-screening)';
    return 'var(--danger)';
  };

  return (
    <div className="score-histogram">
      {buckets.map((b) => (
        <div key={b.label} className="hist-column">
          <span className="hist-count">{b.count}</span>
          <div
            title={`Score ${b.label}: ${b.count} applicant${b.count !== 1 ? 's' : ''}`}
            className="hist-bar"
            style={{
              height: `${Math.max(18, (b.count / max) * 120)}px`,
              background: b.count ? barColor(b.min) : 'var(--line)',
            }}
          />
          <span className="hist-label">{b.label}</span>
        </div>
      ))}
    </div>
  );
}


export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/dashboard/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!stats) return <div className="empty">Loading…</div>;

  const totalScored = stats.scoreDistribution?.reduce((s, b) => s + b.count, 0) ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="subtle">Hiring at a glance</p>
        </div>
      </div>

      <div className="stats">
        <div className="card stat">
          <div className="num">{stats.openJobs}</div>
          <div className="lbl">Open roles</div>
        </div>
        <div className="card stat">
          <div className="num">{stats.activeApplications}</div>
          <div className="lbl">In pipeline</div>
        </div>
        <div className="card stat">
          <div className="num">{stats.totalCandidates}</div>
          <div className="lbl">Candidates</div>
        </div>
        <div className="card stat accent">
          <div className="num">{stats.hired}</div>
          <div className="lbl">Hired</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 0 }}>
        {/* Pipeline breakdown */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <h3 style={{ marginBottom: 16, fontSize: 15 }}>Pipeline breakdown</h3>
          {Object.entries(stats.byStage).map(([stage, count]) => {
            const max = Math.max(1, ...Object.values(stats.byStage));
            return (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
                <div style={{ width: 90, fontSize: 13, color: 'var(--muted)' }}>{STAGE_LABELS[stage]}</div>
                <div style={{ flex: 1, background: '#f0f1f4', borderRadius: 6, height: 22, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${(count / max) * 100}%`,
                      height: '100%',
                      background: stage === 'HIRED' ? 'var(--gold)' : 'var(--primary)',
                      minWidth: count ? 4 : 0,
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div style={{ width: 28, textAlign: 'right', fontWeight: 600 }}>{count}</div>
              </div>
            );
          })}
        </div>

        {/* Score distribution histogram */}
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <h3 style={{ fontSize: 15 }}>Score distribution</h3>
            {totalScored > 0 && (
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{totalScored} scored</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
            <span style={{ color: 'var(--stage-hired)', fontWeight: 600 }}>■</span> ≥70 &nbsp;
            <span style={{ color: 'var(--stage-screening)', fontWeight: 600 }}>■</span> 50–69 &nbsp;
            <span style={{ color: 'var(--danger)', fontWeight: 600 }}>■</span> &lt;50
          </div>
          <ScoreHistogram buckets={stats.scoreDistribution} />
        </div>
      </div>
    </>
  );
}
