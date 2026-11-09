// Loads .env files for a backend process: the app's own .env (if it has one), then the repo-root .env that
// both backends share locally. Values already in the environment win over both, and an app's own file wins
// over the root one (dotenv never overwrites a variable that is already set).
const path = require('path');
const dotenv = require('dotenv');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function loadEnv(appDir) {
  // quiet: dotenv 17 otherwise prints a line (with an advert) for every file on every start.
  if (appDir) dotenv.config({ path: path.join(appDir, '.env'), quiet: true });
  dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });
}

module.exports = { loadEnv, REPO_ROOT };
