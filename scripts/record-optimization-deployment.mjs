import fs from 'node:fs';
import path from 'node:path';

const [deploymentId, stage] = process.argv.slice(2);
if (!deploymentId?.startsWith('dpl_') || !['polling-log', 'cache', 'final'].includes(stage))
  throw new Error('Specify a deployment ID and optimization stage.');
const auth = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json'), 'utf8'));
const response = await fetch(`https://api.vercel.com/v13/deployments/${deploymentId}?teamId=team_cIiMcR8YXHgU2LztGPMYZyjZ`, {
  headers: { Authorization: `Bearer ${auth.token}` },
});
if (!response.ok) throw new Error(`Deployment read failed: HTTP ${response.status}`);
const data = await response.json();
const record = {
  stage, checkedAt: new Date().toISOString(), id: data.id, url: data.url,
  name: data.name, target: data.target, readyState: data.readyState,
  createdAt: data.createdAt, buildingAt: data.buildingAt, ready: data.ready,
  regions: data.regions, aliasAssigned: data.aliasAssigned, aliases: data.alias,
};
fs.writeFileSync(`outputs/optimization-20261004/deployment-${stage}.json`, JSON.stringify(record, null, 2));
console.log(JSON.stringify(record));
