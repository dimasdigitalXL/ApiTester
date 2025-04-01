// promptHelper.js

const readline = require("readline");

function promptUserForId(message) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

module.exports = { promptUserForId };
