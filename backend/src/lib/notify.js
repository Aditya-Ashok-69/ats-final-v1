import { prisma } from './prisma.js';

// Create an in-app notification for one user.
export async function notifyUser(userId, type, message, link = null) {
  if (!userId) return;
  await prisma.notification.create({ data: { userId, type, message, link } });
}

// Notify the people responsible for a job: hiring manager + application owner.
export async function notifyJobStakeholders({ job, ownerId, type, message, link }) {
  const ids = new Set([job?.hiringManagerId, ownerId].filter(Boolean));
  await Promise.all([...ids].map((id) => notifyUser(id, type, message, link)));
}

// Build a copy-ready email draft for candidate-facing comms.
// No email is sent — the recruiter pastes this into their mail client.
export function buildCandidateEmail({ kind, candidateName, jobTitle, interviewAt }) {
  const name = candidateName || 'there';
  switch (kind) {
    case 'ADVANCED':
      return {
        subject: `Update on your ${jobTitle} application`,
        body: `Hi ${name},\n\nThanks for applying for the ${jobTitle} role. We've reviewed your application and would like to move you forward to the next stage. We'll be in touch shortly with details.\n\nBest,\nThe Hiring Team`,
      };
    case 'INTERVIEW':
      return {
        subject: `Interview invitation — ${jobTitle}`,
        body: `Hi ${name},\n\nWe'd like to invite you to an interview for the ${jobTitle} role${
          interviewAt ? `, scheduled for ${new Date(interviewAt).toLocaleString()}` : ''
        }. Please let us know if that works for you.\n\nBest,\nThe Hiring Team`,
      };
    case 'REVIEW':
      return {
        subject: `Your ${jobTitle} application`,
        body: `Hi ${name},\n\nThanks for applying for the ${jobTitle} role. Your application is under review and we'll follow up soon.\n\nBest,\nThe Hiring Team`,
      };
    default:
      return { subject: `Your ${jobTitle} application`, body: `Hi ${name},\n\nThank you for applying.` };
  }
}
