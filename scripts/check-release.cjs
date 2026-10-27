const { execFileSync } = require('node:child_process');
const app = require('../app.json').expo;
const pkg = require('../package.json');
const tag = process.env.GITHUB_REF_NAME;
if (tag !== `v${app.version}` || pkg.version !== app.version || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  throw new Error('Release tag, app.json and package.json versions must match.');
}
execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']);
