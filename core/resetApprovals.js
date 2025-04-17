// core/resetApprovals.js

const fs = require("fs-extra");
const { resolveProjectPath } = require("./utils");
const approvalsFile = resolveProjectPath("pending-approvals.json");

/**
 * Setzt nur die approval‑Status zurück, 
 * bewahrt jedoch den gecachten Block‑Array unter __rawBlocks.
 */
async function resetApprovals() {
  const approvals = await fs.readJson(approvalsFile);
  // speicher den Block‑Cache
  const rawBlocks = approvals.__rawBlocks || {};

  // baue ein neues Objekt nur mit __rawBlocks und zurückgesetzten Endpoints
  const newApprovals = { __rawBlocks: rawBlocks };
  for (const key of Object.keys(approvals)) {
    if (key === "__rawBlocks") continue;
    // hier je nachdem, wie du in pending-approvals.json deine Endpoints trackst:
    // newApprovals[key] = "waiting";
    // oder falls es ein Objekt ist:
    newApprovals[key] = "waiting";
  }

  await fs.writeJson(approvalsFile, newApprovals, { spaces: 2 });
}

module.exports = { resetApprovals };