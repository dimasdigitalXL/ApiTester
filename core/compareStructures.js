// compareStructures.js

function compareStructures(expected, actual, path = "") {
    const missingFields = [];
    const extraFields = [];
    const typeMismatches = [];
  
    if (Array.isArray(expected) && Array.isArray(actual)) {
      if (expected.length > 0 && actual.length > 0) {
        return compareStructures(expected[0], actual[0], path);
      }
      return { missingFields, extraFields, typeMismatches };
    }
  
    if (typeof expected !== "object" || typeof actual !== "object" || !expected || !actual) {
      return { missingFields, extraFields, typeMismatches };
    }
  
    for (const key in expected) {
      if (!(key in actual)) {
        missingFields.push(`${path ? path + "." : ""}${key}`);
      } else if (
        typeof expected[key] === "object" &&
        expected[key] !== null &&
        typeof actual[key] === "object" &&
        actual[key] !== null
      ) {
        const subResult = compareStructures(expected[key], actual[key], `${path ? path + "." : ""}${key}`);
        missingFields.push(...subResult.missingFields);
        extraFields.push(...subResult.extraFields);
        typeMismatches.push(...subResult.typeMismatches);
      } else if (typeof expected[key] !== typeof actual[key]) {
        typeMismatches.push({
          path: `${path ? path + "." : ""}${key}`,
          expected: typeof expected[key],
          actual: typeof actual[key]
        });
      }
    }
  
    for (const key in actual) {
      if (!(key in expected)) {
        extraFields.push(`${path ? path + "." : ""}${key}`);
      }
    }
  
    return { missingFields, extraFields, typeMismatches };
  }
  
  module.exports = compareStructures;
  