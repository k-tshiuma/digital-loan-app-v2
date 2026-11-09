/**
 * Seed initial staff users for testing and Back Office administration.
 * Usage: node backend/scripts/seed_staff.js
 */
const bcrypt = require('bcryptjs');
const db = require('@quickloan/backend-core/database');
const { dbGet, dbRun, newId } = require('@quickloan/backend-core/services/dbHelpers');

const DEFAULT_STAFF = [
  {
    email: 'admin@quickloan.co.il',
    fullName: 'System Administrator',
    password: process.env.ADMIN_INITIAL_PASSWORD || 'Admin123456!',
    role: 'system_admin',
  },
  {
    email: 'reviewer@quickloan.co.il',
    fullName: 'Credit Reviewer',
    password: process.env.REVIEWER_INITIAL_PASSWORD || 'Reviewer123456!',
    role: 'credit_reviewer',
  },
  {
    email: 'service@quickloan.co.il',
    fullName: 'Customer Service Representative',
    password: process.env.SERVICE_INITIAL_PASSWORD || 'Service123456!',
    role: 'customer_service',
  },
  {
    email: 'funding@quickloan.co.il',
    fullName: 'Funding Officer',
    password: process.env.FUNDING_INITIAL_PASSWORD || 'Funding123456!',
    role: 'funding_entity',
  },
];

async function seedStaff() {
  const now = new Date().toISOString();
  console.log('Seeding initial staff users...');
  for (const s of DEFAULT_STAFF) {
    const existing = await dbGet('SELECT * FROM staff_users WHERE lower(email) = lower(?)', [s.email]);
    if (!existing) {
      const hash = await bcrypt.hash(s.password, 10);
      const id = newId('staff');
      await dbRun(
        `INSERT INTO staff_users (id, email, fullName, password, role, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, s.email, s.fullName, hash, s.role, now, now]
      );
      console.log(`  + Created ${s.role}: ${s.email}`);
    } else {
      console.log(`  = Exists ${s.role}: ${s.email}`);
    }
  }
  console.log('Staff seeding complete.');
}

if (require.main === module) {
  seedStaff().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('Failed to seed staff:', err);
    process.exit(1);
  });
}

module.exports = { seedStaff, DEFAULT_STAFF };
