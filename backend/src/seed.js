import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { prisma } from './lib/prisma.js';
import { scoreResume } from './lib/scoring.js';

async function main() {
  console.log('Seeding…');

  await prisma.notification.deleteMany();
  await prisma.scorecard.deleteMany();
  await prisma.interview.deleteMany();
  await prisma.activityLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.rating.deleteMany();
  await prisma.onboardingHandoff.deleteMany();
  await prisma.application.deleteMany();
  await prisma.candidate.deleteMany();
  await prisma.job.deleteMany();
  await prisma.user.deleteMany();

  const pw = await bcrypt.hash('password123', 10);

  const admin = await prisma.user.create({
    data: { name: 'Ava Recruiter', email: 'admin@ats.dev', passwordHash: pw, role: 'ADMIN' },
  });
  const manager = await prisma.user.create({
    data: { name: 'Marco Manager', email: 'manager@ats.dev', passwordHash: pw, role: 'HIRING_MANAGER' },
  });
  const interviewer = await prisma.user.create({
    data: { name: 'Lena Engineer', email: 'lena@ats.dev', passwordHash: pw, role: 'HIRING_MANAGER' },
  });

  const feJob = await prisma.job.create({
    data: {
      title: 'Senior Frontend Engineer',
      department: 'Engineering',
      location: 'Remote',
      status: 'OPEN',
      hiringManagerId: manager.id,
      description:
        'Senior frontend engineer to build React applications with TypeScript and a Node.js GraphQL backend. Design-system experience a plus.',
      requiredSkills: JSON.stringify(['React', 'TypeScript', 'Node.js', 'GraphQL']),
      niceToHaveSkills: JSON.stringify(['Docker', 'AWS']),
      minYearsExperience: 5,
      scoreThreshold: 70,
      shortlistThreshold: 70,
    },
  });
  const designJob = await prisma.job.create({
    data: {
      title: 'Product Designer',
      department: 'Design',
      location: 'Bengaluru',
      status: 'OPEN',
      hiringManagerId: manager.id,
      description: 'Product designer skilled in Figma, prototyping and design systems.',
      requiredSkills: JSON.stringify(['Figma', 'Prototyping', 'Design Systems']),
      minYearsExperience: 3,
    },
  });
  await prisma.job.create({
    data: { title: 'DevOps Engineer', department: 'Engineering', location: 'Hybrid', status: 'ON_HOLD' },
  });

  // Candidates with resume text so the scoring engine has something to chew on.
  const people = [
    ['Priya Sharma', 'priya@example.com', 'LinkedIn', 'Senior Frontend Engineer, 7 years. Expert in React, TypeScript, Node.js and GraphQL. Built design systems. Docker and AWS.'],
    ['John Carter', 'john@example.com', 'Referral', 'Frontend developer, 6 years. React, TypeScript, Node.js. Some GraphQL exposure.'],
    ['Mei Lin', 'mei@example.com', 'Careers Page', 'Full-stack developer, 5 years. React and JavaScript. Learning TypeScript. No GraphQL.'],
    ['Diego Alvarez', 'diego@example.com', 'LinkedIn', 'Software engineer, 4 years. Vue and Python. Interested in moving to React.'],
    ['Sara Okeke', 'sara@example.com', 'Referral', 'Frontend engineer, 8 years. React, TypeScript, Node.js, GraphQL, Docker, AWS. Led design system work.'],
    ['Tom Becker', 'tom@example.com', 'Careers Page', 'Junior developer, 2 years. HTML, CSS, some React.'],
  ];

  const candidates = [];
  for (const [name, email, source, resumeText] of people) {
    candidates.push(await prisma.candidate.create({ data: { name, email, source, resumeText } }));
  }

  const job = await prisma.job.findUnique({ where: { id: feJob.id } });
  const jobScoring = {
    requiredSkills: JSON.parse(job.requiredSkills),
    niceToHaveSkills: JSON.parse(job.niceToHaveSkills),
    minYearsExperience: job.minYearsExperience,
    jdText: job.description || '',
  };

  // Apply each candidate to the frontend job, scoring + routing like the live flow.
  for (const c of candidates) {
    const { score, breakdown } = scoreResume({ resumeText: c.resumeText, ...jobScoring });
    const passes = score >= job.scoreThreshold;
    const app = await prisma.application.create({
      data: {
        candidateId: c.id,
        jobId: job.id,
        stage: passes ? 'SCREENING' : 'APPLIED',
        ownerId: admin.id,
        matchScore: score,
        matchBreakdown: JSON.stringify(breakdown),
        flaggedForReview: !passes,
      },
    });
    await prisma.activityLog.create({
      data: {
        applicationId: app.id,
        action: passes ? 'AUTO_ADVANCED' : 'FLAGGED_FOR_REVIEW',
        toStage: passes ? 'SCREENING' : 'APPLIED',
      },
    });
  }

  // One designer applicant for variety.
  await prisma.application.create({
    data: { candidateId: candidates[2].id, jobId: designJob.id, stage: 'APPLIED', ownerId: admin.id, matchScore: 40, flaggedForReview: true },
  });

  // A seeded notification for the recruiter.
  await prisma.notification.create({
    data: { userId: manager.id, type: 'NEW_APPLICANT', message: 'New applicants scored and routed for Senior Frontend Engineer.', link: `/jobs/${feJob.id}` },
  });

  console.log('Seed complete.');
  console.log('Logins (all password123):');
  console.log('  admin@ats.dev    ADMIN');
  console.log('  manager@ats.dev  HIRING_MANAGER');
  console.log('  lena@ats.dev     HIRING_MANAGER (interviewer)');
  console.log(`Public apply form: /apply/${feJob.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
