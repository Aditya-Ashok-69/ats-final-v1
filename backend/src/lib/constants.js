// Single source of truth for enum-like values (SQLite has no native enums).

export const ROLES = ['ADMIN', 'RECRUITER', 'HIRING_MANAGER'];

export const STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED', 'REJECTED'];

// Stages that represent an active pipeline (shown as Kanban columns).
export const PIPELINE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'HIRED'];

export const JOB_STATUSES = ['OPEN', 'ON_HOLD', 'CLOSED'];

export const isValidStage = (s) => STAGES.includes(s);
export const isValidRole = (r) => ROLES.includes(r);
