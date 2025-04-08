const fs = require("fs-extra");
const { resolveProjectPath } = require("./utils");

async function resetApprovals() {
  const approvalsPath = resolveProjectPath("pending-approvals.json");

  if (await fs.exists(approvalsPath)) {
    const data = await fs.readJson(approvalsPath);
    let wasModified = false;

    for (const key in data) {
      if (data[key] === "approved") {
        data[key] = "waiting";
        wasModified = true;
      }
    }

    if (wasModified) {
      await fs.writeJson(approvalsPath, data, { spaces: 2 });
      console.log("♻️ Alle 'approved'-Zustände wurden zurück auf 'waiting' gesetzt.");
    }
  }
}

module.exports = { resetApprovals };